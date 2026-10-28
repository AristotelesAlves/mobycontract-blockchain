import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { keccak256, toUtf8Bytes, ZeroHash } from "ethers";
import { aditivoIdOnChain, contratoIdOnChain, deterministicHash, deterministicHashV2, hashPseudonimo, TIPO_HASH, vistoriaIdOnChain } from "../src/hashing";
import { CONTRATO, SAL, ancorarContrato, esperarErroDoContrato, hashDocumentoDeTeste, implantarRegistry, partesDoContrato } from "./helpers";

describe("MobyContractRegistry - RF08, RF09, R-11.1.1 a R-11.1.7", () => {
  describe("registro do contrato", () => {
    it("ancora o contrato e devolve a chave derivada do identificador de negocio", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave, recibo } = await ancorarContrato(ambiente);

      expect(await ambiente.contrato.existeContrato(chave)).to.equal(true);
      expect(chave).to.equal(contratoIdOnChain(CONTRATO.contratoId));
      expect(recibo!.status).to.equal(1);
    });

    it("a chave on-chain bate com a derivacao do modulo de hashing", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      expect(chave).to.equal(keccak256(toUtf8Bytes(CONTRATO.contratoId)));
    });

    it("R-11.1.2 - somente conta autorizada registra", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.intruso)
          .registrarContrato(
            CONTRATO.contratoId,
            deterministicHash(CONTRATO),
            deterministicHashV2(CONTRATO),
            hashDocumentoDeTeste(CONTRATO.contratoId),
            hashPseudonimo(CONTRATO.inquilinoId, SAL),
            hashPseudonimo(CONTRATO.imovelId, SAL),
            TIPO_HASH.PDF,
            365,
            0,
            hashPseudonimo(CONTRATO.modeloId, SAL),
            (await partesDoContrato(ambiente)).todas
          ),
        ambiente.contrato,
        "E_UNAUTHORIZED"
      );

      expect(await ambiente.contrato.totalContratos()).to.equal(0n);
    });

    it("R-11.1.4 - um segundo registro do mesmo contrato e revertido", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      await ancorarContrato(ambiente);

      await esperarErroDoContrato(ancorarContrato(ambiente), ambiente.contrato, "E_CONTRACT_EXISTS");
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });

    it("R-11.1.7 - o mesmo contrato produz o mesmo hash deterministico", async () => {
      expect(deterministicHash(CONTRATO)).to.equal(deterministicHash({ ...CONTRATO }));
      expect(deterministicHashV2(CONTRATO)).to.not.equal(deterministicHash(CONTRATO));
    });

    it("R-11.1.7 - qualquer alteracao de dado muda o hash deterministico", async () => {
      const original = deterministicHash(CONTRATO);
      const variantes = [
        { ...CONTRATO, contratoId: "2026/0002" },
        { ...CONTRATO, valorMensalCentavos: "185001" },
        { ...CONTRATO, dataInicio: "2026-02-02" },
        { ...CONTRATO, garantia: "Fiador" },
        { ...CONTRATO, versao: 2 },
      ];

      for (const variante of variantes) {
        expect(deterministicHash(variante), JSON.stringify(variante)).to.not.equal(original);
      }
    });

    it("rejeita ancora sem hash de documento (R-8.1)", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.registrador)
          .registrarContrato(
            CONTRATO.contratoId,
            deterministicHash(CONTRATO),
            deterministicHashV2(CONTRATO),
            ZeroHash,
            hashPseudonimo(CONTRATO.inquilinoId, SAL),
            hashPseudonimo(CONTRATO.imovelId, SAL),
            TIPO_HASH.PDF,
            365,
            0,
            hashPseudonimo(CONTRATO.modeloId, SAL),
            (await partesDoContrato(ambiente)).todas
          ),
        ambiente.contrato,
        "E_NO_HASH"
      );
    });

    it("rejeita contrato sem partes", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.registrador)
          .registrarContrato(
            CONTRATO.contratoId,
            deterministicHash(CONTRATO),
            deterministicHashV2(CONTRATO),
            hashDocumentoDeTeste(CONTRATO.contratoId),
            hashPseudonimo(CONTRATO.inquilinoId, SAL),
            hashPseudonimo(CONTRATO.imovelId, SAL),
            TIPO_HASH.PDF,
            365,
            0,
            hashPseudonimo(CONTRATO.modeloId, SAL),
            []
          ),
        ambiente.contrato,
        "E_EMPTY_PARTIES"
      );
    });

    it("rejeita identificador de negocio vazio", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.registrador)
          .registrarContrato(
            "",
            deterministicHash(CONTRATO),
            deterministicHashV2(CONTRATO),
            hashDocumentoDeTeste(CONTRATO.contratoId),
            hashPseudonimo(CONTRATO.inquilinoId, SAL),
            hashPseudonimo(CONTRATO.imovelId, SAL),
            TIPO_HASH.PDF,
            365,
            0,
            hashPseudonimo(CONTRATO.modeloId, SAL),
            (await partesDoContrato(ambiente)).todas
          ),
        ambiente.contrato,
        "E_EMPTY_ID"
      );
    });

    it("rejeita indice de reajuste fora do catalogo", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.registrador)
          .registrarContrato(
            CONTRATO.contratoId,
            deterministicHash(CONTRATO),
            deterministicHashV2(CONTRATO),
            hashDocumentoDeTeste(CONTRATO.contratoId),
            hashPseudonimo(CONTRATO.inquilinoId, SAL),
            hashPseudonimo(CONTRATO.imovelId, SAL),
            TIPO_HASH.PDF,
            365,
            9,
            hashPseudonimo(CONTRATO.modeloId, SAL),
            (await partesDoContrato(ambiente)).todas
          ),
        ambiente.contrato,
        "E_INVALID_REAJUSTE"
      );
    });

    it("grava numero do bloco e instante do registro como prova de posicao", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave, recibo } = await ancorarContrato(ambiente);
      const registro = await ambiente.contrato.consultarContrato(chave);

      expect(registro.bloco).to.equal(recibo!.blockNumber);
      expect(registro.registradoEm).to.be.greaterThan(0n);
      expect(registro.registroPor).to.equal(await ambiente.endereco("registrador"));
    });

    it("as tres ancoragens ficam gravadas no mesmo registro", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const registro = await ambiente.contrato.consultarContrato(chave);

      expect(registro.contratoHash).to.equal(hashDocumentoDeTeste(CONTRATO.contratoId));
      expect(registro.deterministicHash).to.equal(deterministicHash(CONTRATO));
      expect(registro.deterministicHashV2).to.equal(deterministicHashV2(CONTRATO));
      expect(registro.locatarioHash).to.equal(hashPseudonimo(CONTRATO.inquilinoId, SAL));
    });
  });

  describe("assinaturas - RF11, RF12, RF13", () => {
    it("registra a assinatura de cada parte e converge para Assinado", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria, locador, locatario } = await partesDoContrato(ambiente);

      expect((await ambiente.contrato.consultarContrato(chave)).status).to.equal(0n);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);
      expect((await ambiente.contrato.consultarContrato(chave)).status).to.equal(1n);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, locador);
      expect((await ambiente.contrato.consultarContrato(chave)).status).to.equal(1n);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, locatario);
      expect((await ambiente.contrato.consultarContrato(chave)).status).to.equal(2n);

      expect(await ambiente.contrato.consultarAssinatura(chave, imobiliaria)).to.equal(true);
      expect(await ambiente.contrato.totalAssinaturas()).to.equal(3n);
    });

    it("impede assinatura duplicada da mesma parte", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);
      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria),
        ambiente.contrato,
        "E_ALREADY_SIGNED"
      );

      expect(await ambiente.contrato.totalAssinaturas()).to.equal(1n);
    });

    it("rejeita parte que nao consta da lista de partes do contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, await ambiente.endereco("intruso")),
        ambiente.contrato,
        "E_REQUIRED_PARTY"
      );
      expect(await ambiente.contrato.consultarAssinatura(chave, await ambiente.endereco("intruso"))).to.equal(false);
    });

    it("rejeita assinatura por quem nao e registrador", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.intruso).registrarAssinatura(chave, imobiliaria),
        ambiente.contrato,
        "E_UNAUTHORIZED"
      );
    });

    it("RF22 - o evento carrega canal, bloco e status resultante", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);
      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);

      const eventos = await ambiente.contrato.queryFilter(ambiente.contrato.filters.AssinaturaRegistrada(chave));
      expect(eventos.length).to.equal(1);

      const argumentos = eventos[0].args as any;
      expect(argumentos.parte.toLowerCase()).to.equal(imobiliaria.toLowerCase());
      expect(argumentos.canal).to.equal(0n);
      expect(argumentos.status).to.equal(1n);
      expect(argumentos.bloco).to.be.greaterThan(0n);
    });

    it("R-11.1.7 - as ancoragens nao mudam quando a assinatura muda", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);
      const antes = await ambiente.contrato.consultarContrato(chave);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);
      const depois = await ambiente.contrato.consultarContrato(chave);

      expect(depois.deterministicHash).to.equal(antes.deterministicHash);
      expect(depois.deterministicHashV2).to.equal(antes.deterministicHashV2);
      expect(depois.contratoHash).to.equal(antes.contratoHash);
      expect(depois.bloco).to.equal(antes.bloco);
      expect(depois.registradoEm).to.equal(antes.registradoEm);
      expect(depois.status).to.not.equal(antes.status);
    });
  });

  describe("aditivos - RF16, R-11.2", () => {
    it("ancora o aditivo vinculado ao contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const hashAditivo = hashDocumentoDeTeste("aditivo-01");
      await ambiente.contrato
        .connect(ambiente.registrador)
        .registrarAditivo("A01", chave, hashAditivo, hashPseudonimo("reajuste", SAL));

      const aditivo = await ambiente.contrato.consultarAditivo(aditivoIdOnChain(chave, "A01"));
      expect(aditivo.contratoId).to.equal(chave);
      expect(aditivo.aditivoHash).to.equal(hashAditivo);
      expect(aditivo.registradoPor).to.equal(await ambiente.endereco("registrador"));
      expect((await ambiente.contrato.consultarAditivos(chave)).length).to.equal(1);
    });

    it("R-11.2.2 - aditivo e imutavel: segundo registro e revertido", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const hashAditivo = hashDocumentoDeTeste("aditivo-01");

      await ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chave, hashAditivo, hashPseudonimo("reajuste", SAL));
      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chave, hashAditivo, hashPseudonimo("reajuste", SAL)),
        ambiente.contrato,
        "E_CONTRACT_EXISTS"
      );

      expect(await ambiente.contrato.totalAditivos()).to.equal(1n);
    });

    it("R-11.2.3 - ancorar aditivo nao altera o status do contrato pai", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);
      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);
      const antes = await ambiente.contrato.consultarContrato(chave);

      await ambiente.contrato
        .connect(ambiente.registrador)
        .registrarAditivo("A01", chave, hashDocumentoDeTeste("aditivo-01"), hashPseudonimo("multa", SAL));

      const depois = await ambiente.contrato.consultarContrato(chave);
      expect(depois.status).to.equal(antes.status);
      expect(depois.bloco).to.equal(antes.bloco);
      expect(depois.registradoEm).to.equal(antes.registradoEm);
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });

    it("rejeita aditivo de contrato inexistente", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", keccak256(toUtf8Bytes("inexistente")), hashDocumentoDeTeste("x"), ZeroHash),
        ambiente.contrato,
        "E_UNKNOWN_CONTRACT"
      );
    });
  });

  describe("vistorias - RF27, RF28, R-9.1.8", () => {
    it("ancora vistoria de imovel sem contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const hashImovel = hashPseudonimo(CONTRATO.imovelId, SAL);
      const chaveVistoria = vistoriaIdOnChain("vistoria-2026-02-10");

      await ambiente.contrato
        .connect(ambiente.registrador)
        .registrarVistoria("vistoria-2026-02-10", ZeroHash, hashImovel, hashDocumentoDeTeste("vistoria-entrada"), 0);

      const vistoria = await ambiente.contrato.consultarVistoria(chaveVistoria);
      expect(vistoria.imovelHash).to.equal(hashImovel);
      expect(vistoria.contratoId).to.equal(ZeroHash);
      expect(vistoria.tipoRelacao).to.equal(0n);
      expect((await ambiente.contrato.consultarVistoriasDoImovel(hashImovel)).length).to.equal(1);
    });

    it("ancora vistoria de contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const hashImovel = hashPseudonimo(CONTRATO.imovelId, SAL);

      await ambiente.contrato
        .connect(ambiente.registrador)
        .registrarVistoria("vistoria-2026-02-11", chave, hashImovel, hashDocumentoDeTeste("vistoria-entrada"), 1);

      expect((await ambiente.contrato.consultarVistoriasDoContrato(chave)).length).to.equal(1);
      expect((await ambiente.contrato.consultarVistoriasDoImovel(hashImovel)).length).to.equal(1);
    });

    it("R-9.1.8 - vistoria de imovel nao aceita contrato orfao", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      await esperarErroDoContrato(
        ambiente.contrato
          .connect(ambiente.registrador)
          .registrarVistoria("v", chave, hashPseudonimo(CONTRATO.imovelId, SAL), hashDocumentoDeTeste("v"), 0),
        ambiente.contrato,
        "E_UNKNOWN_CONTRACT"
      );
    });

    it("rejeita segunda ancora da mesma vistoria", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const hashImovel = hashPseudonimo(CONTRATO.imovelId, SAL);

      await ambiente.contrato.connect(ambiente.registrador).registrarVistoria("v1", ZeroHash, hashImovel, hashDocumentoDeTeste("v"), 0);
      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarVistoria("v1", ZeroHash, hashImovel, hashDocumentoDeTeste("v"), 0),
        ambiente.contrato,
        "E_VISTORIA_EXISTS"
      );

      expect(await ambiente.contrato.totalVistorias()).to.equal(1n);
    });

    it("rejeita tipo de relacao fora do catalogo", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarVistoria("v1", ZeroHash, hashPseudonimo("i", SAL), hashDocumentoDeTeste("v"), 7),
        ambiente.contrato,
        "E_INVALID_VISTORIA_TYPE"
      );
    });
  });

  describe("verificacao de integridade - RF21, R-8.2", () => {
    it("confere o PDF original contra a ancora", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave, hash } = await ancorarContrato(ambiente);

      const [integro, hashAncorado] = await ambiente.contrato.verificarIntegridade(chave, hash);
      expect(integro).to.equal(true);
      expect(hashAncorado).to.equal(hash);
    });

    it("acusa divergencia quando um unico byte do PDF e alterado", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const [integro] = await ambiente.contrato.verificarIntegridade(chave, hashDocumentoDeTeste(CONTRATO.contratoId + " "));
      expect(integro).to.equal(false);
    });

    it("verifica integridade de aditivo e de vistoria", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const hashImovel = hashPseudonimo(CONTRATO.imovelId, SAL);
      const chaveAditivo = aditivoIdOnChain(chave, "A01");
      const chaveVistoria = vistoriaIdOnChain("v1");

      await ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chave, hashDocumentoDeTeste("ad"), hashPseudonimo("r", SAL));
      await ambiente.contrato.connect(ambiente.registrador).registrarVistoria("v1", ZeroHash, hashImovel, hashDocumentoDeTeste("vis"), 0);

      expect((await ambiente.contrato.verificarIntegridadeAditivo(chaveAditivo, hashDocumentoDeTeste("ad")))[0]).to.equal(true);
      expect((await ambiente.contrato.verificarIntegridadeAditivo(chaveAditivo, hashDocumentoDeTeste("xx")))[0]).to.equal(false);
      expect((await ambiente.contrato.verificarIntegridadeVistoria(chaveVistoria, hashDocumentoDeTeste("vis")))[0]).to.equal(true);
      expect((await ambiente.contrato.verificarIntegridadeVistoria(chaveVistoria, hashDocumentoDeTeste("zz")))[0]).to.equal(false);
    });

    it("verificarIntegridade e uma view: nao consome gas nem altera estado", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const antes = await ambiente.contrato.consultarContrato(chave);
      await ambiente.contrato.verificarIntegridade.staticCall(chave, antes.contratoHash);
      const depois = await ambiente.contrato.consultarContrato(chave);

      expect(depois.bloco).to.equal(antes.bloco);
    });
  });

  describe("RNF04 - privacidade e LGPD", () => {
    it("a ancora nao contem sequencia de 11 digitos nem caractere arroba", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const [semPII, bytes] = await ambiente.contrato.auditarPrivacidade(chave);
      expect(semPII).to.equal(true);
      expect(bytes).to.be.greaterThan(0n);
    });

    it("o pseudonimo muda com o sal, logo nao e reversivel por tabela", async () => {
      expect(hashPseudonimo("52998224725", "sal-a")).to.not.equal(hashPseudonimo("52998224725", "sal-b"));
      expect(hashPseudonimo("52998224725", "sal-a")).to.have.lengthOf(66);
    });

    it("hashPseudonimo sem sal falha em vez de produzir um hash sem protecao", async () => {
      const salAnterior = process.env.PSEUDONIMO_SALT;
      delete process.env.PSEUDONIMO_SALT;
      try {
        expect(() => hashPseudonimo("52998224725")).to.throw(/PSEUDONIMO_SALT/);
      } finally {
        if (salAnterior !== undefined) process.env.PSEUDONIMO_SALT = salAnterior;
      }
    });
  });

  describe("RNF02 - imutabilidade", () => {
    it("nao existe funcao de remocao nem de sobrescrita no contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const proibidas = ["remover", "excluir", "deletar", "apagar", "delete", "remove", "update", "atualizar", "setStatus", "overwrite", "destroy"];

      for (const nome of proibidas) {
        expect((ambiente.contrato.interface as any).getFunction(nome), `funcao mutadora encontrada: ${nome}`).to.equal(null);
      }
    });

    it("os contadores so crescem", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      await ancorarContrato(ambiente);
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);

      await esperarErroDoContrato(ancorarContrato(ambiente), ambiente.contrato, "E_CONTRACT_EXISTS");
      await esperarErroDoContrato(
        ancorarContrato(ambiente, { contratoId: "2026/0002", signer: "intruso" }),
        ambiente.contrato,
        "E_UNAUTHORIZED"
      );

      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });

    it("a segunda ancora antifalsificacao nao pode ser sobrescrita", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const original = (await ambiente.contrato.consultarContrato(chave)).deterministicHashV2;

      await ambiente.contrato.connect(ambiente.admin).registrarCorrecaoAncoragem(chave, hashDocumentoDeTeste("correcao"));

      expect((await ambiente.contrato.consultarContrato(chave)).deterministicHashV2).to.equal(original);
    });

    it("revogar o papel impede novas ancoragens sem apagar as existentes", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      await ambiente.contrato.connect(ambiente.admin).revogarRegistrador(await ambiente.endereco("registrador"));

      await esperarErroDoContrato(ancorarContrato(ambiente, { contratoId: "2026/0009" }), ambiente.contrato, "E_ROLE_REVOKED");
      expect(await ambiente.contrato.existeContrato(chave)).to.equal(true);
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });

    it("a correcao de ancoragem e um evento append-only", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      expect((await ambiente.contrato.queryFilter(ambiente.contrato.filters.ContratoRegistrado(chave))).length).to.equal(1);

      const hashCorrigido = hashDocumentoDeTeste("correcao");
      await ambiente.contrato.connect(ambiente.admin).registrarCorrecaoAncoragem(chave, hashCorrigido);

      const eventos = await ambiente.contrato.queryFilter(ambiente.contrato.filters.CorrecaoAncoragem(chave));
      expect(eventos.length).to.equal(1);

      const argumentos = eventos[0].args as any;
      expect(argumentos.hashCorrigido).to.equal(hashCorrigido);
      expect(argumentos.executadoPor).to.equal(await ambiente.endereco("admin"));
      expect((await ambiente.contrato.queryFilter(ambiente.contrato.filters.ContratoRegistrado(chave))).length).to.equal(1);
    });

    it("o historico de eventos cresce a cada ancoragem e nunca regride", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria, locador, locatario } = await partesDoContrato(ambiente);

      const contar = async () => (await ambiente.contrato.queryFilter(ambiente.contrato.filters.AssinaturaRegistrada(chave))).length;
      expect(await contar()).to.equal(0);

      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria);
      expect(await contar()).to.equal(1);
      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, locador);
      expect(await contar()).to.equal(2);
      await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, locatario);
      expect(await contar()).to.equal(3);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria),
        ambiente.contrato,
        "E_ALREADY_SIGNED"
      );
      expect(await contar()).to.equal(3);
    });
  });

  describe("administracao de papeis - RF31", () => {
    it("concede e revoga o papel de registrador", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const alvo = await ambiente.endereco("outroRegistrador");
      expect(await ambiente.contrato.registradores(alvo)).to.equal(true);

      await ambiente.contrato.connect(ambiente.admin).revogarRegistrador(alvo);
      expect(await ambiente.contrato.registradores(alvo)).to.equal(false);

      await ambiente.contrato.connect(ambiente.admin).concederRegistrador(alvo);
      expect(await ambiente.contrato.registradores(alvo)).to.equal(true);
    });

    it("so o administrador administra papeis", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.intruso).concederRegistrador(await ambiente.endereco("intruso")),
        ambiente.contrato,
        "E_UNAUTHORIZED"
      );
      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.intruso).revogarRegistrador(await ambiente.endereco("registrador")),
        ambiente.contrato,
        "E_UNAUTHORIZED"
      );
    });

    it("um segundo registrador autorizado tambem pode ancorar", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      await ancorarContrato(ambiente);
      await ancorarContrato(ambiente, { contratoId: "2026/0002", signer: "outroRegistrador" });

      expect(await ambiente.contrato.totalContratos()).to.equal(2n);
      expect((await ambiente.contrato.contratosDoRegistrador(await ambiente.endereco("registrador"))).length).to.equal(1);
      expect((await ambiente.contrato.contratosDoRegistrador(await ambiente.endereco("outroRegistrador"))).length).to.equal(1);
    });
  });

  describe("consultas sobre registros inexistentes", () => {
    it("consultar contrato inexistente reverte", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const chaveInexistente = keccak256(toUtf8Bytes("nao-existe"));

      await esperarErroDoContrato(ambiente.contrato.consultarContrato(chaveInexistente), ambiente.contrato, "E_UNKNOWN_CONTRACT");
      expect(await ambiente.contrato.existeContrato(chaveInexistente)).to.equal(false);
    });

    it("consultar aditivo e vistoria inexistentes reverte", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const chaveInexistente = keccak256(toUtf8Bytes("nao-existe"));

      await esperarErroDoContrato(ambiente.contrato.consultarAditivo(chaveInexistente), ambiente.contrato, "E_UNKNOWN_ADITIVO");
      await esperarErroDoContrato(ambiente.contrato.consultarVistoria(chaveInexistente), ambiente.contrato, "E_UNKNOWN_VISTORIA");
    });

    it("consultar aditivo de contrato inexistente reverte", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      await esperarErroDoContrato(
        ambiente.contrato.consultarAditivos(keccak256(toUtf8Bytes("nao-existe"))),
        ambiente.contrato,
        "E_UNKNOWN_CONTRACT"
      );
    });
  });
});
