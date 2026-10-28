import { expect } from "chai";
import { createServer } from "node:http";
import { Wallet } from "ethers";
import { ServicoDeAncoragem } from "../registry/src/aplicacao/servico-de-ancoragem";
import { PedidoDeContrato } from "../registry/src/dominio/dto/pedido-contrato";
import { AssinadorWeb3Signer } from "../registry/src/infra/assinador-web3signer";
import { RegistroClient, type FabricaDeAssinador } from "../registry/src/infra/registro-client";
import { iniciarServidorDeTeste, type Harness } from "../registry/src/teste/harness";

const CHAVE_DEPLOYER = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const CHAIN_ID = 31337;

function pdfEmBase64(identificador: string): string {
  return Buffer.from(`%PDF-1.4\n% ${identificador}\n%%EOF\n`, "utf8").toString("base64");
}

function camposDoContrato(contratoId: string) {
  return {
    versaoEsquema: 1,
    contratoId,
    imovelId: "imovel-77",
    inquilinoId: "inquilino-31",
    dataInicio: "2026-02-01",
    dataFim: "2027-01-31",
    valorMensalCentavos: "185000",
    garantia: "Caução",
    modeloId: "modelo-locacao-v3",
  };
}

interface Web3SignerStub {
  url: string;
  chamadas: string[];
  fechar: () => Promise<void>;
}

/**
 * Stub do Web3Signer que assina de verdade com a chave da parte e devolve a
 * raw tx, imitando `eth_signTransaction` (que retorna a string direta).
 */
async function subirWeb3Signer(chave: string): Promise<Web3SignerStub> {
  const carteira = new Wallet(chave);
  const chamadas: string[] = [];

  const servidor = createServer((req, res) => {
    let corpo = "";
    req.on("data", (parte) => (corpo += parte));
    req.on("end", async () => {
      const rpc = JSON.parse(corpo) as { id: number; method: string; params: Array<Record<string, string>> };
      chamadas.push(rpc.method);
      res.setHeader("content-type", "application/json");

      try {
        if (rpc.method === "eth_signTransaction") {
          const pedido = rpc.params[0]!;
          const transacao: Record<string, unknown> = {
            to: pedido.to,
            data: pedido.data,
            nonce: Number(BigInt(pedido.nonce!)),
            gasLimit: BigInt(pedido.gas!),
            value: BigInt(pedido.value ?? "0x0"),
            chainId: BigInt(pedido.chainId!),
            ...(pedido.gasPrice ? { gasPrice: BigInt(pedido.gasPrice) } : {}),
            ...(pedido.maxFeePerGas
              ? { maxFeePerGas: BigInt(pedido.maxFeePerGas) }
              : {}),
            ...(pedido.maxPriorityFeePerGas
              ? { maxPriorityFeePerGas: BigInt(pedido.maxPriorityFeePerGas) }
              : {}),
            ...(pedido.type ? { type: Number(BigInt(pedido.type)) } : {}),
          };

          res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: await carteira.signTransaction(transacao) }));
          return;
        }

        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: await carteira.getAddress() }));
      } catch (erro) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { message: erro instanceof Error ? erro.message : String(erro) } }));
      }
    });
  });

  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}/`,
    chamadas,
    fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
}

function novoCliente(rpcUrl: string, enderecoContrato: string, web3SignerUrl: string | null, fabrica?: FabricaDeAssinador): RegistroClient {
  return new RegistroClient(
    {
      rpcUrl,
      chainIdEsperado: CHAIN_ID,
      enderecoContrato,
      chavePrivada: CHAVE_DEPLOYER,
      nomeChain: "hardhat-node-teste",
      web3SignerUrl,
    },
    fabrica
  );
}

describe("assinatura por parte via Web3Signer", () => {
  let harness: Harness;

  before(async function () {
    this.timeout(180_000);
    harness = await iniciarServidorDeTeste();
  });

  after(async () => {
    await harness?.fechar();
  });

  async function fundarParte(endereco: string): Promise<void> {
    await harness.provider.send("hardhat_setBalance", [endereco, "0x" + (100n * 10n ** 18n).toString(16)]);
  }

  async function concederRegistrador(cliente: RegistroClient, endereco: string): Promise<void> {
    const admin = new Wallet(CHAVE_DEPLOYER, harness.provider);
    const comoAdmin = cliente.contrato.connect(admin) as unknown as { concederRegistrador: (c: string) => Promise<{ wait: () => Promise<unknown> }> };
    await (await comoAdmin.concederRegistrador(endereco)).wait();
  }

  it("o adaptador recusa assinatura de mensagem e preserva o endereco", async () => {
    const assinador = new AssinadorWeb3Signer("http://127.0.0.1:9/", "0xAbC0000000000000000000000000000000000001", harness.provider);

    expect(await assinador.getAddress()).to.equal("0xAbC0000000000000000000000000000000000001");
    await expect(assinador.signMessage()).to.be.rejectedWith("assina apenas transacoes");
    await expect(assinador.signTypedData({}, {}, {})).to.be.rejectedWith("assina apenas transacoes");
  });

  it("com assinante e Web3Signer configurado, ancora em nome da parte", async function () {
    this.timeout(60_000);

    const chaveParte = Wallet.createRandom().privateKey;
    const parte = new Wallet(chaveParte);
    await fundarParte(parte.address);

    const web3signer = await subirWeb3Signer(chaveParte);
    const cliente = novoCliente(harness.rpcUrl, harness.enderecoContrato, web3signer.url);

    try {
      await concederRegistrador(cliente, parte.address);
      const servico = new ServicoDeAncoragem(cliente);
      const pedido = PedidoDeContrato.deJson({
        ...camposDoContrato("2026/0777"),
        partes: [parte.address],
        documentoBase64: pdfEmBase64("2026/0777"),
      });

      const ancora = await servico.ancorarContrato(pedido, parte.address);
      const consulta = await cliente.consultarContrato(ancora.chave);

      expect(web3signer.chamadas).to.include("eth_signTransaction");
      expect(consulta.registroPor.toLowerCase()).to.equal(parte.address.toLowerCase());
    } finally {
      await web3signer.fechar();
    }
  });

  it("sem assinante usa a carteira local do servico mesmo com Web3Signer configurado", async function () {
    this.timeout(60_000);

    const web3signer = await subirWeb3Signer(Wallet.createRandom().privateKey);
    const cliente = novoCliente(harness.rpcUrl, harness.enderecoContrato, web3signer.url);
    const servico = new ServicoDeAncoragem(cliente);

    try {
      const pedido = PedidoDeContrato.deJson({
        ...camposDoContrato("2026/0778"),
        partes: [new Wallet(CHAVE_DEPLOYER).address],
        documentoBase64: pdfEmBase64("2026/0778"),
      });

      const ancora = await servico.ancorarContrato(pedido);
      const consulta = await cliente.consultarContrato(ancora.chave);

      expect(web3signer.chamadas).to.not.include("eth_signTransaction");
      expect(consulta.registroPor.toLowerCase()).to.equal(new Wallet(CHAVE_DEPLOYER).address.toLowerCase());
    } finally {
      await web3signer.fechar();
    }
  });

  it("a fabrica injetada tem prioridade sobre a URL configurada", async function () {
    this.timeout(60_000);

    const chaveParte = Wallet.createRandom().privateKey;
    const parte = new Wallet(chaveParte);
    await fundarParte(parte.address);

    const web3signer = await subirWeb3Signer(chaveParte);
    const fabrica: FabricaDeAssinador = (endereco, provider) => new AssinadorWeb3Signer(web3signer.url, endereco, provider);
    const cliente = novoCliente(harness.rpcUrl, harness.enderecoContrato, "http://127.0.0.1:9/", fabrica);

    try {
      await concederRegistrador(cliente, parte.address);
      const servico = new ServicoDeAncoragem(cliente);
      const pedido = PedidoDeContrato.deJson({
        ...camposDoContrato("2026/0779"),
        partes: [parte.address],
        documentoBase64: pdfEmBase64("2026/0779"),
      });

      const ancora = await servico.ancorarContrato(pedido, parte.address);
      const consulta = await cliente.consultarContrato(ancora.chave);

      expect(web3signer.chamadas).to.include("eth_signTransaction");
      expect(consulta.registroPor.toLowerCase()).to.equal(parte.address.toLowerCase());
    } finally {
      await web3signer.fechar();
    }
  });
});
