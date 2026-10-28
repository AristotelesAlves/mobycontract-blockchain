import { Contract, JsonRpcProvider, TransactionReceipt, Wallet, type InterfaceAbi, type Signer } from "ethers";
import type { ComandoDeAditivo, ComandoDeContrato, ComandoDeVistoria } from "../dominio/comando";
import type { Ancora, ConsultaDeContrato, EventoDeHistorico, ResultadoDeIntegridade, SaudeLedger, TransacaoDeContrato, VerificacaoDeRede } from "../dominio/resultado";
import type { EscritaEmNome, PortaLedger } from "../aplicacao/porta-ledger";
import { AssinadorWeb3Signer } from "./assinador-web3signer";
import { abiDoContrato } from "./artefato";
import type { Configuracao } from "./configuracao";

/**
 * Adaptador da porta Ledger sobre ethers.
 *
 * Concentra o que e especifico de Polygon: RPC, gas, assinatura, leitura de
 * evento, decodificacao de struct. Nenhuma regra de negocio mora aqui - quem
 * decide se a operacao e valida e `ServicoDeAncoragem`.
 */
export type FabricaDeAssinador = (endereco: string, provider: JsonRpcProvider) => Signer;

const EVENTOS_AUDITAVEIS: ReadonlyArray<{ evento: string; topicDaChave: number | null }> = [
  { evento: "ContratoRegistrado", topicDaChave: 1 },
  { evento: "AssinaturaRegistrada", topicDaChave: 1 },
  { evento: "AditivoRegistrado", topicDaChave: 2 },
  { evento: "VistoriaRegistrada", topicDaChave: 3 },
  { evento: "CorrecaoAncoragem", topicDaChave: 1 },
  { evento: "RegistradorConcedido", topicDaChave: null },
  { evento: "RegistradorRevogado", topicDaChave: null },
];

const EVENTOS_COM_CHAVE: ReadonlySet<string> = new Set(["ContratoRegistrado", "AditivoRegistrado", "VistoriaRegistrada"]);

interface LogBruto {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

type MetodoAssinavel = (...argumentos: unknown[]) => Promise<{ hash: string; wait: () => Promise<TransactionReceipt | null> }>;

function paraHexadecimal(quantidade: number): string {
  return `0x${quantidade.toString(16)}`;
}

export class RegistroClient implements PortaLedger {
  readonly provider: JsonRpcProvider;
  readonly contrato: Contract;
  readonly endereco: string;
  readonly nomeChain: string;

  private conta: Wallet | null = null;
  private readonly assinadores = new Map<string, Signer>();

  constructor(
    private readonly configuracao: Configuracao,
    private readonly fabricaDeAssinador?: FabricaDeAssinador
  ) {
    this.provider = new JsonRpcProvider(configuracao.rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
    this.endereco = configuracao.enderecoContrato;
    this.nomeChain = configuracao.nomeChain;
    this.contrato = new Contract(configuracao.enderecoContrato, this.abi(), this.provider);
  }

  async registrarContrato(comando: ComandoDeContrato, emNome?: EscritaEmNome): Promise<Ancora> {
    return this.enviar("registrarContrato", [
      comando.contratoId,
      comando.deterministicHash,
      comando.deterministicHashV2,
      comando.contratoHash,
      comando.locatarioHash,
      comando.imovelHash,
      comando.tipoHash,
      comando.prazoVigenciaDias,
      comando.indiceReajuste,
      comando.documentoModeloHash,
      comando.partes,
    ], emNome);
  }

  async registrarAssinatura(chave: string, parte: string, emNome?: EscritaEmNome): Promise<Ancora> {
    return this.enviar("registrarAssinatura", [chave, parte], emNome);
  }

  async registrarAditivo(comando: ComandoDeAditivo, emNome?: EscritaEmNome): Promise<Ancora> {
    return this.enviar("registrarAditivo", [comando.aditivoId, comando.contratoId, comando.aditivoHash, comando.tipoObjetoHash], emNome);
  }

  async registrarVistoria(comando: ComandoDeVistoria, emNome?: EscritaEmNome): Promise<Ancora> {
    return this.enviar("registrarVistoria", [comando.vistoriaId, comando.contratoId, comando.imovelHash, comando.vistoriaHash, comando.tipoRelacao], emNome);
  }

  async existeContrato(chave: string): Promise<boolean> {
    return this.contrato.existeContrato(chave);
  }

  async consultarContrato(chave: string): Promise<ConsultaDeContrato> {
    const registro = (await this.contrato.consultarContrato(chave)) as unknown as RegistroDaChain;
    const partes = (await this.contrato.consultarPartes(chave)) as string[];

    return {
      status: Number(registro.status),
      registroPor: registro.registroPor,
      registradoEm: Number(registro.registradoEm),
      bloco: Number(registro.bloco),
      hashDocumento: registro.contratoHash,
      deterministicHash: registro.deterministicHash,
      deterministicHashV2: registro.deterministicHashV2,
      prazoVigenciaDias: Number(registro.prazoVigenciaDias),
      indiceReajuste: Number(registro.indiceReajuste),
      tipoHash: Number(registro.tipoHash),
      partes,
    };
  }

  async consultarPartes(chave: string): Promise<string[]> {
    return (await this.contrato.consultarPartes(chave)) as string[];
  }

  async contratosDaParte(endereco: string): Promise<string[]> {
    return (await this.contrato.contratosDaParte(endereco)) as string[];
  }

  async consultarAssinaturas(chave: string, partes: string[]): Promise<Record<string, boolean>> {
    const resultado: Record<string, boolean> = {};
    for (const parte of partes) resultado[parte] = await this.contrato.consultarAssinatura(chave, parte);
    return resultado;
  }

  async consultarHistorico(chave: string, desdeBloco: number): Promise<EventoDeHistorico[]> {
    const brutos: LogBruto[] = [];

    for (const { evento, topicDaChave } of EVENTOS_AUDITAVEIS) {
      const fragmento = this.contrato.interface.getEvent(evento);
      if (!fragmento) throw new Error(`evento auditavel ausente no contrato: ${evento}`);

      const topics: Array<string | null> = fragmento.inputs.map(() => null);
      if (topicDaChave !== null) topics[topicDaChave - 1] = chave;
      while (topics.length > 0 && topics[topics.length - 1] === null) topics.pop();

      const consulta = await this.provider.send("eth_getLogs", [
        { address: this.endereco, fromBlock: paraHexadecimal(desdeBloco), toBlock: "latest", topics: [fragmento.topicHash, ...topics] },
      ]);

      brutos.push(...(consulta as LogBruto[]));
    }

    return brutos
      .map((bruto) => this.eventoDeHistorico(bruto, chave))
      .filter((evento): evento is EventoDeHistorico => evento !== null)
      .sort((esquerda, direita) => esquerda.bloco - direita.bloco || esquerda.logIndex - direita.logIndex);
  }

  async verificarIntegridade(chave: string, documentoHash: string): Promise<ResultadoDeIntegridade> {
    const [integro, hashAncorado] = (await this.contrato.verificarIntegridade(chave, documentoHash)) as [boolean, string];
    return { integro, hashAncorado };
  }

  async consultarTransacao(hashTransacao: string): Promise<TransacaoDeContrato | null> {
    const recibo = await this.provider.getTransactionReceipt(hashTransacao);
    if (!recibo || recibo.status !== 1 || recibo.to?.toLowerCase() !== this.endereco.toLowerCase()) return null;

    for (const log of recibo.logs) {
      if (log.address.toLowerCase() !== this.endereco.toLowerCase() || this.nomeDoEvento(log) !== "ContratoRegistrado") continue;

      const evento = this.contrato.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (!evento) continue;

      const alturaAtual = await this.provider.getBlockNumber();
      return {
        hashTransacao,
        numeroBloco: recibo.blockNumber,
        confirmacoes: Math.max(1, alturaAtual - recibo.blockNumber + 1),
        chave: String(evento.args.id),
        hashDocumento: String(evento.args.contratoHash),
      };
    }

    return null;
  }

  async verificarRede(): Promise<VerificacaoDeRede> {
    const atual = Number((await this.provider.getNetwork()).chainId);
    return { chainId: atual, nome: this.nomeChain, confere: atual === this.configuracao.chainIdEsperado };
  }

  async saude(): Promise<SaudeLedger> {
    const [rede, altura] = await Promise.all([this.verificarRede(), this.provider.getBlockNumber()]);

    return {
      status: rede.confere ? "ok" : "rede_incorreta",
      nomeChain: this.nomeChain,
      chainId: rede.chainId,
      chainIdEsperado: this.configuracao.chainIdEsperado,
      enderecoContrato: this.endereco,
      alturaBloco: altura,
      timestamp: new Date().toISOString(),
    };
  }

  private async enviar(nomeDoMetodo: string, argumentos: unknown[], emNome?: EscritaEmNome): Promise<Ancora> {
    const rede = await this.verificarRede();
    if (!rede.confere) {
      throw new Error(`rede incorreta: esperado chainId ${this.configuracao.chainIdEsperado}, conectou em ${rede.chainId}`);
    }

    const Metodo = (this.contrato.connect(this.signerDaVez(emNome?.assinante)) as unknown as Record<string, MetodoAssinavel>)[nomeDoMetodo];
    const transacao = await Metodo(...argumentos);
    const recibo = await transacao.wait();

    if (!recibo || recibo.status !== 1) throw new Error(`transacao ${transacao.hash} revertida sem motivo padronizado`);

    const bloco = await this.provider.getBlock(recibo.blockNumber);
    const alturaAtual = await this.provider.getBlockNumber();

    return {
      chave: this.chaveDoRetorno(recibo),
      hashTransacao: transacao.hash,
      numeroBloco: recibo.blockNumber,
      carimboTempo: bloco?.timestamp ?? 0,
      confirmacoes: Math.max(1, alturaAtual - recibo.blockNumber + 1),
    };
  }

  private signerDaVez(assinante?: string | null): Signer {
    if (!assinante) return this.signer();

    const fabrica = this.fabricaDeAssinador ?? this.fabricaPadrao();
    if (!fabrica) return this.signer();

    const chave = assinante.toLowerCase();
    const existente = this.assinadores.get(chave);
    if (existente) return existente;

    const novo = fabrica(assinante, this.provider);
    this.assinadores.set(chave, novo);
    return novo;

  }

  private fabricaPadrao(): FabricaDeAssinador | null {
    const url = this.configuracao.web3SignerUrl;
    if (!url) return null;
    return (endereco, provider) => new AssinadorWeb3Signer(url, endereco, provider);
  }

  private signer(): Wallet {
    this.conta ??= new Wallet(this.configuracao.chavePrivada, this.provider);
    return this.conta;
  }

  private abi(): InterfaceAbi {
    return abiDoContrato();
  }

  private chaveDoRetorno(recibo: TransactionReceipt): string {
    for (const log of recibo.logs) {
      const nome = this.nomeDoEvento(log);
      if (!nome || !EVENTOS_COM_CHAVE.has(nome)) continue;

      const parsed = this.contrato.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed) return String(parsed.args[0]);
    }
    return "";
  }

  private nomeDoEvento(log: { topics: readonly string[]; data: string }): string | null {
    try {
      return this.contrato.interface.parseLog({ topics: [...log.topics], data: log.data })?.name ?? null;
    } catch {
      return null;
    }
  }

  private eventoDeHistorico(bruto: LogBruto, chave: string): EventoDeHistorico | null {
    const parsed = this.contrato.interface.parseLog({ topics: bruto.topics, data: bruto.data });
    if (!parsed) return null;

    return {
      evento: parsed.name,
      chave,
      bloco: Number(BigInt(bruto.blockNumber)),
      hashTransacao: bruto.transactionHash,
      logIndex: Number(BigInt(bruto.logIndex)),
      argumentos: Object.fromEntries(
        parsed.fragment.inputs.map((entrada, indice) => {
          const valor = parsed.args[indice];
          return [entrada.name, typeof valor === "bigint" ? valor.toString() : valor];
        })
      ),
    };
  }
}

interface RegistroDaChain {
  deterministicHash: string;
  deterministicHashV2: string;
  contratoHash: string;
  registroPor: string;
  registradoEm: bigint;
  bloco: bigint | number;
  prazoVigenciaDias: bigint | number;
  indiceReajuste: bigint | number;
  status: bigint | number;
  tipoHash: bigint | number;
}
