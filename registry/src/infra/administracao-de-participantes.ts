import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import type { CapacidadeDeParticipantes, PortaParticipantes } from "../aplicacao/porta-participantes";
import type { ConfiguracaoDeParticipantes } from "./configuracao";

/**
 * Adaptador da porta Particionantes sobre Besu + ethers + Web3Signer.
 *
 * Concentra o que e especifico deste consorcio: a API PERM dos nos (allowlist de
 * contas), os contratos `RegistroDeParticipantes`/`MobyContractRegistry`
 * assinados pela governanca e o keystore em arquivo do Web3Signer. Nenhuma
 * regra de negocio mora aqui - quem decide a ordem e o que pular e
 * `ServicoDeParticipantes`.
 */

type MetodoAssinavel = (...argumentos: unknown[]) => Promise<{ hash: string; wait: () => Promise<{ status: number } | null> }>;

const ABI_CONSORCIO = ["function habilitar(address,uint8)", "function tornarExCliente(address)"];
const ABI_LEDGER = ["function concederRegistrador(address)", "function revogarRegistrador(address)"];

export function editarAllowlistDeContas(toml: string, endereco: string, acao: "adicionar" | "remover"): string {
  const padrao = /accounts-allowlist = \[([^\]]*)\]/;
  const linha = toml.match(padrao);
  if (!linha) throw new Error("permissions_config.toml sem a chave accounts-allowlist");

  const alvo = endereco.toLowerCase();
  const atuais = linha[1]
    .split(",")
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  const proximos =
    acao === "adicionar"
      ? atuais.some((item) => item.toLowerCase() === alvo)
        ? atuais
        : [...atuais, alvo]
      : atuais.filter((item) => item.toLowerCase() !== alvo);

  return toml.replace(padrao, `accounts-allowlist = [${proximos.map((item) => `"${item}"`).join(", ")}]`);
}

export function montarYamlDaChave(chavePrivada: string): string {
  return `type: "file-raw"\nkeyType: "SECP256K1"\nprivateKey: "${chavePrivada}"\n`;
}

export function extrairChavePrivada(yaml: string): string | null {
  return yaml.match(/privateKey:\s*"?(0x[0-9a-fA-F]{64})"?/)?.[1] ?? null;
}

async function chamarNo(url: string, metodo: string, params: unknown[]): Promise<unknown> {
  const resposta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
  });
  const corpo = (await resposta.json()) as { result?: unknown; error?: { message?: string } };
  if (corpo.error) throw new Error(`${metodo} em ${url}: ${corpo.error.message ?? JSON.stringify(corpo.error)}`);
  return corpo.result;
}

export class AdministracaoDeParticipantes implements PortaParticipantes {
  private readonly provider: JsonRpcProvider;
  private readonly consorcio: Contract;
  private readonly ledger: Contract;

  constructor(private readonly configuracao: ConfiguracaoDeParticipantes) {
    this.provider = new JsonRpcProvider(configuracao.rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
    const governanca = new Wallet(configuracao.chaveGovernanca, this.provider);
    this.consorcio = new Contract(configuracao.enderecoParticipantes, ABI_CONSORCIO, governanca);
    this.ledger = new Contract(configuracao.enderecoLedger, ABI_LEDGER, governanca);
  }

  capacidade(): CapacidadeDeParticipantes {
    return {
      permissao: this.configuracao.rpcUrlsAdmin.length > 0,
      chaves: Boolean(this.configuracao.web3SignerKeystoreDir && this.configuracao.web3SignerUrl),
    };
  }

  derivarEndereco(chavePrivada: string): string {
    return new Wallet(chavePrivada).address;
  }

  async publicarChave(nome: string, chavePrivada: string): Promise<string> {
    const diretorio = this.keystore();
    mkdirSync(diretorio, { recursive: true });
    writeFileSync(join(diretorio, `${nome}.yaml`), montarYamlDaChave(chavePrivada), "utf8");
    return new Wallet(chavePrivada).address;
  }

  async gerarChave(nome: string): Promise<string> {
    return this.publicarChave(nome, Wallet.createRandom().privateKey);
  }

  async enderecoDaChave(nome: string): Promise<string | null> {
    const caminho = join(this.keystore(), `${nome}.yaml`);
    if (!existsSync(caminho)) return null;
    const chave = extrairChavePrivada(readFileSync(caminho, "utf8"));
    return chave ? new Wallet(chave).address : null;
  }

  async removerChave(nome: string): Promise<void> {
    const caminho = join(this.keystore(), `${nome}.yaml`);
    if (existsSync(caminho)) unlinkSync(caminho);
  }

  async adicionarNaAllowlist(endereco: string): Promise<void> {
    for (const url of this.configuracao.rpcUrlsAdmin) {
      await chamarNo(url, "perm_addAccountsToAllowlist", [[endereco]]);
    }
    this.persistirAllowlist(endereco, "adicionar");
  }

  async removerDaAllowlist(endereco: string): Promise<void> {
    for (const url of this.configuracao.rpcUrlsAdmin) {
      await chamarNo(url, "perm_removeAccountsFromAllowlist", [[endereco]]);
    }
    this.persistirAllowlist(endereco, "remover");
  }

  habilitarNoConsorcio(endereco: string, papel: number): Promise<string> {
    return this.escrever(this.consorcio, "habilitar", endereco, papel);
  }

  encerrarNoConsorcio(endereco: string): Promise<string> {
    return this.escrever(this.consorcio, "tornarExCliente", endereco);
  }

  concederRegistrador(endereco: string): Promise<string> {
    return this.escrever(this.ledger, "concederRegistrador", endereco);
  }

  revogarRegistrador(endereco: string): Promise<string> {
    return this.escrever(this.ledger, "revogarRegistrador", endereco);
  }

  async recarregarAssinador(): Promise<void> {
    const url = this.configuracao.web3SignerUrl;
    if (!url) return;
    const resposta = await fetch(`${url.replace(/\/$/, "")}/reload`, { method: "POST" });
    if (!resposta.ok) throw new Error(`reload do Web3Signer falhou com status ${resposta.status}`);
  }

  private keystore(): string {
    const diretorio = this.configuracao.web3SignerKeystoreDir;
    if (!diretorio) throw new Error("keystore do Web3Signer nao configurado");
    return diretorio;
  }

  private persistirAllowlist(endereco: string, acao: "adicionar" | "remover"): void {
    const arquivo = this.configuracao.permissionamentoArquivo;
    if (!arquivo) return;
    if (!existsSync(arquivo)) throw new Error(`arquivo de permissao nao encontrado: ${arquivo}`);
    const atual = readFileSync(arquivo, "utf8");
    writeFileSync(arquivo, editarAllowlistDeContas(atual, endereco, acao), "utf8");
  }

  private async escrever(contrato: Contract, nomeDoMetodo: string, ...argumentos: unknown[]): Promise<string> {
    const metodo = (contrato as unknown as Record<string, MetodoAssinavel>)[nomeDoMetodo];
    const transacao = await metodo(...argumentos);
    const recibo = await transacao.wait();
    if (!recibo || recibo.status !== 1) throw new Error(`transacao ${transacao.hash} revertida`);
    return transacao.hash;
  }
}
