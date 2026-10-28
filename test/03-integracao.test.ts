import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { keccak256, toUtf8Bytes, ZeroHash } from "ethers";
import { TIPO_HASH, contratoIdOnChain, deterministicHash, deterministicHashV2, hashDocumentoBytes, hashPseudonimo } from "../src/hashing";
import { CONTRATO, SAL, ancorarContrato, esperarErroDoContrato, implantarRegistry, partesDoContrato } from "./helpers";
import { iniciarServidorDeTeste, type Harness } from "../registry/src/teste/harness";

describe("integracao do registry service", () => {
  let harness: Harness;
  let baseUrl: string;
  let enderecoImobiliaria: string;
  let enderecoLocador: string;
  let enderecoLocatario: string;

  before(async function () {

    this.timeout(180_000);
    harness = await iniciarServidorDeTeste();
    baseUrl = harness.baseUrl;
    enderecoImobiliaria = harness.partes.imobiliaria;
    enderecoLocador = harness.partes.locador;
    enderecoLocatario = harness.partes.locatario;
  });

  after(async () => {
    await harness?.fechar();
  });

  async function chamar(rota: string, init?: RequestInit): Promise<{ status: number; corpo: any }> {
    const resposta = await fetch(`${baseUrl}${rota}`, {
      ...init,
      headers: { "content-type": "application/json", "x-api-key": harness.chaveApi, ...(init?.headers ?? {}) },
    });
    return { status: resposta.status, corpo: await resposta.json() };
  }

  function camposDoContrato(contratoId: string) {
    return {
      versao: 1,
      contratoId,
      imovelId: "imovel-12",
      inquilinoId: "inquilino-88",
      dataInicio: "2026-03-01",
      dataFim: "2027-02-28",
      valorMensalCentavos: "240000",
      garantia: "Caução" as const,
      modeloId: "modelo-locacao-v3",
    };
  }

  function pdfEmBase64(identificador: string): string {
    return Buffer.from(`%PDF-1.4\n% MobyContract ${identificador}\n%%EOF\n`, "utf8").toString("base64");
  }

  it("GET /saude responde com a rede conectada", async () => {
    const { status, corpo } = await chamar("/saude");

    expect(status).to.equal(200);
    expect(corpo.status).to.equal("ok");
    expect(corpo.chainId).to.equal(31337);
    expect(corpo.enderecoContrato).to.equal(harness.enderecoContrato);
    expect(corpo.alturaBloco).to.be.greaterThan(0);
  });

  it("ancora um contrato e devolve chave, bloco e hash do documento", async () => {
    const campos = camposDoContrato("2026/0042");
    const { status, corpo } = await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({ ...campos, partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario], documentoBase64: pdfEmBase64("2026/0042") }),
    });

    expect(status).to.equal(201);
    expect(corpo.chave).to.equal(contratoIdOnChain("2026/0042"));
    expect(corpo.hashTransacao).to.match(/^0x[0-9a-fA-F]{64}$/);
    expect(corpo.numeroBloco).to.be.greaterThan(0);
    expect(corpo.carimboTempo).to.be.greaterThan(0);
    expect(corpo.confirmacoes).to.be.greaterThan(0);
    expect(corpo.hashDocumento).to.equal(hashDocumentoBytes(Buffer.from(pdfEmBase64("2026/0042"), "base64")));
  });

  it("o hash deterministico calculado pelo service bate com o do modulo compartilhado", async () => {
    const campos = camposDoContrato("2026/0043");
    await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({ ...campos, partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario], documentoBase64: pdfEmBase64("2026/0043") }),
    });

    const { corpo } = await chamar("/contratos/2026/0043");
    expect(corpo.deterministicHash).to.equal(deterministicHash(campos));
    expect(corpo.deterministicHashV2).to.equal(deterministicHashV2(campos));
  });

  it("R-11.1.4 - reancorar o mesmo contrato devolve 409 e nao cria segundo registro", async () => {
    const campos = camposDoContrato("2026/0044");
    const carga = {
      ...campos,
      partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario],
      documentoBase64: pdfEmBase64("2026/0044"),
    };

    const primeira = await chamar("/ancoras/contratos", { method: "POST", body: JSON.stringify(carga) });
    expect(primeira.status).to.equal(201);

    const segunda = await chamar("/ancoras/contratos", { method: "POST", body: JSON.stringify(carga) });
    expect(segunda.status).to.equal(409);
    expect(segunda.corpo.erro.codigo).to.equal("FALHA_CONTRATO");
    expect(segunda.corpo.erro.detalhe.motivo).to.equal("E_CONTRACT_EXISTS");

    const { corpo } = await chamar("/contratos/2026/0044");
    expect(corpo.bloco).to.equal(primeira.corpo.numeroBloco);
  });

  it("RF21 - verifica integridade do PDF original e acusa o adulterado", async () => {
    const identificador = "2026/0050";
    await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({
        ...camposDoContrato(identificador),
        partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario],
        documentoBase64: pdfEmBase64(identificador),
      }),
    });

    const conforme = await chamar(`/contratos/${identificador}/integridade`, {
      method: "POST",
      body: JSON.stringify({ documentoBase64: pdfEmBase64(identificador) }),
    });
    expect(conforme.status).to.equal(200);
    expect(conforme.corpo.integro).to.equal(true);

    const adulterado = await chamar(`/contratos/${identificador}/integridade`, {
      method: "POST",
      body: JSON.stringify({ documentoBase64: pdfEmBase64(`${identificador} adulterado`) }),
    });
    expect(adulterado.status).to.equal(200);
    expect(adulterado.corpo.integro).to.equal(false);
    expect(adulterado.corpo.hashAncorado).to.not.equal(adulterado.corpo.hashInformado);
  });

  it("RF13 - registra assinaturas e reflete o status no contrato", async () => {
    const identificador = "2026/0051";
    await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({
        ...camposDoContrato(identificador),
        partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario],
        documentoBase64: pdfEmBase64(identificador),
      }),
    });

    for (const parte of [enderecoImobiliaria, enderecoLocador, enderecoLocatario]) {
      const resposta = await chamar("/ancoras/assinaturas", { method: "POST", body: JSON.stringify({ contratoId: identificador, parte }) });
      expect(resposta.status, `assinatura de ${parte}`).to.equal(201);
    }

    const { corpo } = await chamar(`/contratos/${identificador}`);
    expect(corpo.status).to.equal(2);
    expect(Object.values(corpo.assinaturas as Record<string, boolean>).every(Boolean)).to.equal(true);
  });

  it("RF22 - o historico reconstroi a linha do tempo a partir dos eventos", async () => {
    const identificador = "2026/0052";
    await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({
        ...camposDoContrato(identificador),
        partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario],
        documentoBase64: pdfEmBase64("contrato"),
      }),
    });
    await chamar("/ancoras/assinaturas", { method: "POST", body: JSON.stringify({ contratoId: identificador, parte: enderecoImobiliaria }) });
    await chamar("/ancoras/aditivos", {
      method: "POST",
      body: JSON.stringify({ contratoId: identificador, aditivoId: "A01", tipoObjeto: "reajuste", documentoBase64: pdfEmBase64("aditivo") }),
    });
    await chamar("/ancoras/vistorias", {
      method: "POST",
      body: JSON.stringify({ vistoriaId: "V01", contratoId: null, imovelId: "imovel-12", tipoRelacao: 0, documentoBase64: pdfEmBase64("vistoria") }),
    });

    const { status, corpo } = await chamar(`/contratos/${identificador}/historico`);
    expect(status).to.equal(200);

    const eventos = corpo.eventos as Array<{ evento: string; bloco: number }>;
    const nomes = eventos.map((evento) => evento.evento);
    expect(nomes).to.include("ContratoRegistrado");
    expect(nomes).to.include("AssinaturaRegistrada");
    expect(nomes).to.include("AditivoRegistrado");

    for (let indice = 1; indice < eventos.length; indice++) {
      expect(eventos[indice]!.bloco).to.be.at.least(eventos[indice - 1]!.bloco);
    }
  });

  it("RF16 e RF28 - aditivo e vistoria sao ancorados", async () => {
    const identificador = "2026/0053";
    await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({
        ...camposDoContrato(identificador),
        partes: [enderecoImobiliaria, enderecoLocador, enderecoLocatario],
        documentoBase64: pdfEmBase64("contrato"),
      }),
    });

    const aditivo = await chamar("/ancoras/aditivos", {
      method: "POST",
      body: JSON.stringify({ contratoId: identificador, aditivoId: "A01", tipoObjeto: "multa", documentoBase64: pdfEmBase64("aditivo") }),
    });
    expect(aditivo.status).to.equal(201);

    const vistoriaDeContrato = await chamar("/ancoras/vistorias", {
      method: "POST",
      body: JSON.stringify({
        vistoriaId: "V10",
        contratoId: identificador,
        imovelId: "imovel-12",
        tipoRelacao: 1,
        documentoBase64: pdfEmBase64("vistoria de contrato"),
      }),
    });
    expect(vistoriaDeContrato.status).to.equal(201);

    const vistoriaDeImovel = await chamar("/ancoras/vistorias", {
      method: "POST",
      body: JSON.stringify({
        vistoriaId: "V11",
        contratoId: null,
        imovelId: "imovel-12",
        tipoRelacao: 0,
        documentoBase64: pdfEmBase64("vistoria de imovel"),
      }),
    });
    expect(vistoriaDeImovel.status).to.equal(201);
  });

  it("rejeita entrada invalida com 422 e campo apontado", async () => {
    const { status, corpo } = await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({ ...camposDoContrato("2026/0060"), dataInicio: "01/03/2026", partes: [enderecoImobiliaria], documentoBase64: pdfEmBase64("x") }),
    });

    expect(status).to.equal(422);
    expect(corpo.erro.familia).to.equal("VALIDACAO");
    expect(corpo.erro.codigo).to.equal("ENTRADA_INVALIDA");
    const campos = corpo.erro.detalhe.campos as Array<{ campo: string }>;
    expect(campos.map((item) => item.campo)).to.include("dataInicio");
  });

  it("exige documento para ancorar", async () => {
    const { status, corpo } = await chamar("/ancoras/contratos", {
      method: "POST",
      body: JSON.stringify({ ...camposDoContrato("2026/0099"), partes: [enderecoImobiliaria] }),
    });

    expect(status).to.equal(422);
    expect(corpo.erro.codigo).to.equal("DOCUMENTO_AUSENTE");
  });

  it("assinatura em contrato nao ancorado devolve 409", async () => {
    const { status, corpo } = await chamar("/ancoras/assinaturas", {
      method: "POST",
      body: JSON.stringify({ contratoId: "2099/9999", parte: enderecoImobiliaria }),
    });

    expect(status).to.equal(409);
    expect(corpo.erro.codigo).to.equal("CONTRATO_NAO_ANCORADO");
  });

  it("consulta de contrato inexistente devolve 409", async () => {
    const { status, corpo } = await chamar("/contratos/2099/9999");

    expect(status).to.equal(409);
    expect(corpo.erro.codigo).to.equal("CONTRATO_NAO_ANCORADO");
  });

  it("exige a chave de API nas rotas protegidas", async () => {

    const resposta = await fetch(`${baseUrl}/contratos/2099/9999`);
    const corpo = (await resposta.json()) as any;

    expect(resposta.status).to.equal(401);
    expect(corpo.erro.codigo).to.equal("CHAVE_INVALIDA");
  });

  it("rejeita chave de API incorreta", async () => {
    const resposta = await fetch(`${baseUrl}/contratos/2099/9999`, { headers: { "x-api-key": "chave-errada" } });

    expect(resposta.status).to.equal(401);
  });

  it("o corpo do erro nunca expoe stack trace", async () => {
    const { corpo } = await chamar("/contratos/2099/9999");
    const serializado = JSON.stringify(corpo);

    expect(serializado).to.not.include("at ");
    expect(serializado).to.not.include(".ts:");
  });
});

describe("integracao - a ancora nunca carrega dado pessoal", () => {
  it("a ledger guarda o pseudonimo do inquilino, e nao o identificador", async () => {
    const ambiente = await loadFixture(implantarRegistry);
    const { chave } = await ancorarContrato(ambiente, { contratoId: "2026/0100" });
    const registro = await ambiente.contrato.consultarContrato(chave);

    expect(registro.locatarioHash).to.equal(hashPseudonimo(CONTRATO.inquilinoId, SAL));
    expect(registro.locatarioHash).to.not.equal(CONTRATO.inquilinoId);
    expect((await ambiente.contrato.auditarPrivacidade(chave))[0]).to.equal(true);
  });

  it("a ancora de um contrato com nome real no hash nao vaza o nome", async () => {
    const ambiente = await loadFixture(implantarRegistry);
    const { chave } = await ancorarContrato(ambiente, { contratoId: "2026/0101" });

    const [semDadosPessoais, bytesDoContrato] = await ambiente.contrato.auditarPrivacidade(chave);
    expect(semDadosPessoais).to.equal(true);
    expect(bytesDoContrato).to.be.lessThan(1000n);
  });

  it("hash de documento e insensivel a caminho de arquivo", async () => {

    const primeiroArquivo = hashDocumentoBytes(Buffer.from("mesmo contrato", "utf8"));
    const segundoArquivo = hashDocumentoBytes(Buffer.from("mesmo contrato", "utf8"));

    expect(primeiroArquivo).to.equal(segundoArquivo);
    expect(primeiroArquivo).to.not.equal(hashDocumentoBytes(Buffer.from("outro contrato", "utf8")));
  });

  it("a derivacao da chave independe do ambiente", async () => {

    expect(contratoIdOnChain("2026/0001")).to.equal(keccak256(toUtf8Bytes("2026/0001")));
    expect(contratoIdOnChain("2026/0001")).to.equal(contratoIdOnChain("2026/0001"));
    expect(contratoIdOnChain("2026/0001")).to.not.equal(contratoIdOnChain("2026/0002"));
  });
});

describe("integracao - argumentos invalidos no contrato", () => {
  it("o contrato propaga o motivo da falha em vez de um erro generico", async () => {
    const ambiente = await loadFixture(implantarRegistry);
    const { chave } = await ancorarContrato(ambiente, { contratoId: "2026/0102" });
    const { imobiliaria } = await partesDoContrato(ambiente);

    await esperarErroDoContrato(
      ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, await ambiente.endereco("intruso")),
      ambiente.contrato,
      "E_REQUIRED_PARTY"
    );

    const chaveContratoInexistente = keccak256(toUtf8Bytes("2099/9999"));
    await esperarErroDoContrato(
      ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chaveContratoInexistente, hashDocumentoBytes(Buffer.from("h")), ZeroHash),
      ambiente.contrato,
      "E_UNKNOWN_CONTRACT"
    );

    await esperarErroDoContrato(
      ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chaveContratoInexistente, ZeroHash, ZeroHash),
      ambiente.contrato,
      "E_NO_HASH"
    );

    expect(await ambiente.contrato.existeContrato(chave)).to.equal(true);
    expect(await ambiente.contrato.consultarAssinatura(chave, imobiliaria)).to.equal(false);
    expect(await ambiente.contrato.consultarAssinatura(chave, await ambiente.endereco("intruso"))).to.equal(false);
  });

  it("o catalogo de hashing nao conflita com o tipo de documento", async () => {
    expect(TIPO_HASH.PDF).to.equal(1);
    expect(deterministicHashV2(CONTRATO)).to.not.equal(deterministicHash(CONTRATO));
  });
});
