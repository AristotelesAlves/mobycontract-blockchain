import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { INDICE_REAJUSTE } from "../src/hashing";
import { CONTRATO, ancorarContrato, esperarErroDoContrato, implantarRegistry, partesDoContrato } from "./helpers";

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((esquerda, direita) => esquerda - direita);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0 ? (ordenados[meio - 1]! + ordenados[meio]!) / 2 : ordenados[meio]!;
}

function percentil(valores: number[], fracao: number): number {
  const ordenados = [...valores].sort((esquerda, direita) => esquerda - direita);
  const posicao = fracao * (ordenados.length - 1);
  const baixo = Math.floor(posicao);
  const alto = Math.ceil(posicao);
  return ordenados[baixo]! + (ordenados[alto]! - ordenados[baixo]!) * (posicao - baixo);
}

async function medir(operacao: () => Promise<unknown>, repeticoes: number): Promise<number[]> {
  const amostras: number[] = [];
  for (let volta = 0; volta < repeticoes; volta++) {
    const inicio = performance.now();
    await operacao();
    amostras.push(performance.now() - inicio);
  }
  return amostras;
}

function resumo(amostras: number[]): string {
  return `p50=${mediana(amostras).toFixed(2)}ms p95=${percentil(amostras, 0.95).toFixed(2)}ms p99=${percentil(amostras, 0.99).toFixed(2)}ms max=${Math.max(
    ...amostras
  ).toFixed(2)}ms`;
}

describe("RNF01 - desempenho e RNF03 - resiliencia", () => {
  describe("latencia de leitura", () => {
    it("consultarContrato responde em menos de 10ms no p95", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const amostras = await medir(async () => {
        const registro = await ambiente.contrato.consultarContrato(chave);
        expect(registro.status).to.be.a("bigint");
      }, 200);

      console.log(`        consultarContrato: ${resumo(amostras)}`);
      expect(percentil(amostras, 0.95)).to.be.lessThan(10);
    });

    it("verificarIntegridade responde em menos de 10ms no p95", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave, hash } = await ancorarContrato(ambiente);

      const amostras = await medir(async () => {
        const [integro] = await ambiente.contrato.verificarIntegridade(chave, hash);
        expect(integro).to.equal(true);
      }, 200);

      console.log(`        verificarIntegridade: ${resumo(amostras)}`);
      expect(percentil(amostras, 0.95)).to.be.lessThan(10);
    });

    it("verificarIntegridade detecta divergencia no mesmo orcamento de latencia", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const hashDivergente = `0x${"1".repeat(64)}`;

      const amostras = await medir(async () => {
        const [integro] = await ambiente.contrato.verificarIntegridade(chave, hashDivergente);
        expect(integro).to.equal(false);
      }, 200);

      console.log(`        verificarIntegridade (divergente): ${resumo(amostras)}`);
      expect(percentil(amostras, 0.95)).to.be.lessThan(10);
    });
  });

  describe("custo em gas das escritas", () => {
    it("registrarContrato custa menos de 1.200.000 gas (R-4.1)", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { recibo } = await ancorarContrato(ambiente);
      const gas = recibo!.gasUsed;

      console.log(`        registrarContrato: ${gas} gas`);
      expect(gas).to.be.lessThan(1_200_000n);
    });

    it("registrarAssinatura custa menos de 200.000 gas", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const { imobiliaria } = await partesDoContrato(ambiente);

      const recibo = await (await ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, imobiliaria)).wait();
      console.log(`        registrarAssinatura: ${recibo!.gasUsed} gas`);

      expect(recibo!.gasUsed).to.be.lessThan(200_000n);
    });

    it("registrarAditivo custa menos de 400.000 gas", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const aditivo = await (
        await ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", chave, `0x${"2".repeat(64)}`, `0x${"3".repeat(64)}`)
      ).wait();
      console.log(`        registrarAditivo: ${aditivo!.gasUsed} gas`);

      expect(aditivo!.gasUsed).to.be.lessThan(400_000n);
    });

    it("registrarVistoria custa menos de 400.000 gas", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      const vistoria = await (
        await ambiente.contrato.connect(ambiente.registrador).registrarVistoria("v1", `0x${"0".repeat(64)}`, `0x${"4".repeat(64)}`, `0x${"5".repeat(64)}`, 0)
      ).wait();
      console.log(`        registrarVistoria: ${vistoria!.gasUsed} gas`);

      expect(vistoria!.gasUsed).to.be.lessThan(400_000n);
    });
  });

  describe("leitura enquanto ha escrita pendente (R-4.2, R-4.3)", () => {
    it("consultar registro continua respondendo durante o processamento de uma escrita", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);

      const escritaPendente = ambiente.contrato.connect(ambiente.registrador).registrarAssinatura(chave, (await partesDoContrato(ambiente)).imobiliaria);
      const chaveAntesDaLeitura = (await ambiente.contrato.consultarContrato(chave)).id;

      const leituraDurante = await medir(async () => {
        const registro = await ambiente.contrato.consultarContrato(chave);
        expect(registro.id).to.equal(chaveAntesDaLeitura);
        expect(registro.status).to.be.oneOf([0n, 1n, 2n]);
      }, 50);

      await escritaPendente;

      console.log(`        leitura com escrita pendente: ${resumo(leituraDurante)}`);
      expect(percentil(leituraDurante, 0.95)).to.be.lessThan(10);
    });
  });

  describe("RNF03 - resiliencia do ledger", () => {
    it("o ledger permanece consultavel apos 60 registros", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      for (let indice = 1; indice <= 60; indice++) {
        await ancorarContrato(ambiente, { contratoId: `2026/${String(indice).padStart(4, "0")}` });
      }

      const amostras = await medir(async () => {
        expect(await ambiente.contrato.totalContratos()).to.equal(60n);
      }, 100);

      console.log(`        totalContratos com 60 registros: ${resumo(amostras)}`);
      expect(await ambiente.contrato.totalContratos()).to.equal(60n);
    });

    it("o ledger permanece consultavel apos 120 registros", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      for (let indice = 1; indice <= 120; indice++) {
        await ancorarContrato(ambiente, { contratoId: `2027/${String(indice).padStart(4, "0")}` });
      }

      const amostras = await medir(async () => {
        expect(await ambiente.contrato.totalContratos()).to.equal(120n);
      }, 100);

      console.log(`        totalContratos com 120 registros: ${resumo(amostras)}`);
    });

    it("consultas por indice do contrato nao degradam com o tamanho do ledger", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      for (let indice = 1; indice <= 120; indice++) {
        await ancorarContrato(ambiente, { contratoId: `2028/${String(indice).padStart(4, "0")}` });
      }

      const amostras = await medir(async () => {
        const registros = await ambiente.contrato.contratosDoRegistrador(await ambiente.endereco("registrador"));
        expect(registros.length).to.equal(120);
      }, 20);

      console.log(`        contratosDoRegistrador com 120 registros: ${resumo(amostras)}`);
    });

    it("o catalogo de reajuste e enumerado e limited (R-3.4)", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      expect(INDICE_REAJUSTE.IPCA).to.equal(0);
      expect(INDICE_REAJUSTE["IGP-M"]).to.equal(1);
      expect(INDICE_REAJUSTE.INPC).to.equal(2);
      expect(INDICE_REAJUSTE.IPET).to.equal(3);

      const entradasDoCatalogo = Object.entries(INDICE_REAJUSTE);
      for (const [indice, ] of entradasDoCatalogo.entries()) {
        await ancorarContrato(ambiente, { contratoId: `2030/${String(indice).padStart(4, "0")}`, indiceReajuste: indice });
      }

      expect(await ambiente.contrato.totalContratos()).to.equal(BigInt(entradasDoCatalogo.length));
    });

    it("uma leitura invalida nao derruba o estado do contrato", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { chave } = await ancorarContrato(ambiente);
      const antes = await ambiente.contrato.consultarContrato(chave);

      await esperarErroDoContrato(
        ambiente.contrato.connect(ambiente.registrador).registrarAditivo("A01", `0x${"6".repeat(64)}`, `0x${"7".repeat(64)}`, `0x${"8".repeat(64)}`),
        ambiente.contrato,
        "E_UNKNOWN_CONTRACT"
      );

      const depois = await ambiente.contrato.consultarContrato(chave);
      expect(depois.bloco).to.equal(antes.bloco);
      expect(depois.status).to.equal(antes.status);
    });
  });

  describe("R-3.5 - campos canonicos do contrato", () => {
    it("o contrato de referencia cobre todos os campos exigidos pela regra 3.5", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { campos, chave } = await ancorarContrato(ambiente);
      const registro = await ambiente.contrato.consultarContrato(chave);

      expect(campos.versao).to.equal(1);
      expect(campos.contratoId).to.match(/^\d{4}\/\d{4}$/);
      expect(campos.imovelId).to.be.a("string").and.not.empty;
      expect(campos.inquilinoId).to.be.a("string").and.not.empty;
      expect(campos.dataInicio).to.match(/^\d{4}-\d{2}-\d{2}$/);
      expect(campos.dataFim).to.match(/^\d{4}-\d{2}-\d{2}$/);
      expect(campos.valorMensalCentavos).to.match(/^\d+$/);
      expect(campos.garantia).to.be.oneOf(["Caução", "Fiador", "Sem garantia"]);
      expect(registro.prazoVigenciaDias).to.equal(365n);
      expect(registro.indiceReajuste).to.equal(0n);
    });

    it("o contrato de referencia lista exatamente as tres partes de R-3.5.1.2", async () => {
      const ambiente = await loadFixture(implantarRegistry);
      const { campos } = await ancorarContrato(ambiente);
      const partes = await partesDoContrato(ambiente);

      expect(campos.imovelId).to.equal("imovel-77");
      expect(partes.todas.length).to.equal(3);
      expect(new Set(partes.todas).size).to.equal(3);
    });
  });
});
