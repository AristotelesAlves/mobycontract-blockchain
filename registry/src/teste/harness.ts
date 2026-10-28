import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { ServicoDeAncoragem } from "../aplicacao/servico-de-ancoragem";
import { criarApp } from "../http/servidor";
import { abiDoContrato, bytecodeDoContrato } from "../infra/artefato";
import { RegistroClient } from "../infra/registro-client";

/**
 * Harness de integracao: sobe um no EVM real e o servico HTTP real sobre ele.
 *
 * A suite nao simula a ledger. Um revert so aparece quando o bytecode roda, e
 * um hash so bate quando o mesmo algoritmo roda dos dois lados - e a garantia
 * que o Apendice C promete a um terceiro sem chave.
 */

const CHAVE_CONTA_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CHAVE_API = "chave-de-teste";
const SAL_DE_TESTE = "sal-de-teste-nao-usar-em-producao";
const CHAIN_ID_LOCAL = 31337;

export interface PartesDoContrato {
  imobiliaria: string;
  locador: string;
  locatario: string;
}

export interface Harness {
  portaNo: number;
  portaService: number;
  rpcUrl: string;
  baseUrl: string;
  enderecoContrato: string;
  enderecoRegistrador: string;
  provider: JsonRpcProvider;
  partes: PartesDoContrato;
  chaveApi: string;
  fechar: () => Promise<void>;
}

export function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.unref();
    servidor.on("error", reject);
    servidor.listen(0, "127.0.0.1", () => {
      const porta = (servidor.address() as { port: number }).port;
      servidor.close(() => resolve(porta));
    });
  });
}

export async function iniciarServidorDeTeste(): Promise<Harness> {
  process.env.PSEUDONIMO_SALT = SAL_DE_TESTE;

  const portaNo = await portaLivre();
  const rpcUrl = `http://127.0.0.1:${portaNo}`;

  const diario: string[] = [];
  const no = spawn(process.execPath, [caminhoDoNo(), "node", "--hostname", "127.0.0.1", "--port", String(portaNo)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HARDHAT_NETWORK: undefined },
  });

  no.stdout.on("data", (d: Buffer) => diario.push(d.toString()));
  no.stderr.on("data", (d: Buffer) => diario.push(d.toString()));

  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, cacheTimeout: -1 });
  await aguardarNo(() => noResponde(provider), 60_000, no, diario);

  const implantador = new Wallet(CHAVE_CONTA_0, provider);
  const fabrica = new ContractFactory(abiDoContrato(), bytecodeDoContrato(), implantador);
  const contrato = await (await fabrica.deploy()).waitForDeployment();
  const enderecoContrato = await contrato.getAddress();

  const contas = (await provider.send("eth_accounts", [])) as string[];
  const partes: PartesDoContrato = {
    imobiliaria: contas[1]!,
    locador: contas[2]!,
    locatario: contas[3]!,
  };

  const servico = new ServicoDeAncoragem(
    new RegistroClient({
      rpcUrl,
      chainIdEsperado: CHAIN_ID_LOCAL,
      enderecoContrato,
      chavePrivada: CHAVE_CONTA_0,
      nomeChain: "hardhat-node-teste",
      web3SignerUrl: null,
    })
  );

  const app = criarApp(servico, { chaveApi: CHAVE_API, rotasPublicas: ["/saude"] });
  const portaService = await portaLivre();
  const servidor = app.listen(portaService, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    servidor.once("listening", resolve);
    servidor.once("error", reject);
  });

  return {
    portaNo,
    portaService,
    rpcUrl,
    baseUrl: `http://127.0.0.1:${portaService}`,
    enderecoContrato,
    enderecoRegistrador: await implantador.getAddress(),
    provider,
    partes,
    chaveApi: CHAVE_API,
    fechar: async () => {
      provider.destroy();

      await Promise.race([
        new Promise<void>((resolve) => servidor.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);

      if (no.exitCode === null) no.kill("SIGKILL");
      no.stdout.destroy();
      no.stderr.destroy();
    },
  };
}

function caminhoDoNo(): string {
  return require.resolve("hardhat/internal/cli/cli.js");
}

async function noResponde(provider: JsonRpcProvider): Promise<boolean> {
  return Number((await provider.getNetwork()).chainId) === CHAIN_ID_LOCAL;
}

async function aguardarNo(verificacao: () => Promise<boolean>, limiteMs: number, processo: ChildProcess, diario: string[]): Promise<void> {
  const inicio = Date.now();
  let ultimoErro: unknown;

  while (Date.now() - inicio < limiteMs) {
    if (processo.exitCode !== null) {
      throw new Error(`o no EVM encerrou com codigo ${processo.exitCode}. saida:\n${diario.join("").slice(-2000)}`);
    }
    try {
      if (await verificacao()) return;
    } catch (erro) {
      ultimoErro = erro;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`o no EVM nao respondeu em ${limiteMs}ms: ${String(ultimoErro)}. saida:\n${diario.join("").slice(-2000)}`);
}