import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { RegistroDeParticipantes__factory } from "../typechain-types";
import { ancorarContrato, esperarErroDoContrato, implantarRegistry } from "./helpers";

const PAPEL = { NENHUM: 0n, GOVERNANCA: 1n, REGISTRADOR: 2n, PARTE: 3n } as const;
const SITUACAO = { INATIVO: 0n, ATIVO: 1n, EXCLIENTE: 2n } as const;

async function implantarConsorcio() {
  const ambiente = await implantarRegistry();

  const participantes = await new RegistroDeParticipantes__factory(ambiente.admin).deploy();
  await participantes.waitForDeployment();

  await ambiente.contrato.definirControladorDeAcesso(await participantes.getAddress());

  await participantes.connect(ambiente.admin).habilitar(await ambiente.endereco("registrador"), PAPEL.REGISTRADOR);
  await participantes.connect(ambiente.admin).habilitar(await ambiente.endereco("outroRegistrador"), PAPEL.REGISTRADOR);
  await participantes.connect(ambiente.admin).habilitar(await ambiente.endereco("locatario"), PAPEL.PARTE);

  return { ambiente, participantes };
}

describe("Consórcio permissionado - RegistroDeParticipantes", () => {
  describe("papeis e situacoes", () => {
    it("a conta que implanta vira a governanca inicial e pode ancorar", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);

      const [papel, situacao] = await participantes.papelDe(await ambiente.endereco("admin"));
      expect(papel).to.equal(PAPEL.GOVERNANCA);
      expect(situacao).to.equal(SITUACAO.ATIVO);
      expect(await participantes.podeAncorar(await ambiente.endereco("admin"))).to.equal(true);
    });

    it("separa registrador (escreve) de parte (nao escreve)", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);

      expect(await participantes.podeAncorar(await ambiente.endereco("registrador"))).to.equal(true);
      expect(await participantes.podeAncorar(await ambiente.endereco("locatario"))).to.equal(false);
      expect(await participantes.estaAtivo(await ambiente.endereco("locatario"))).to.equal(true);

      const [papel] = await participantes.papelDe(await ambiente.endereco("locatario"));
      expect(papel).to.equal(PAPEL.PARTE);
    });

    it("somente a governanca habilita novos participantes", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);

      await esperarErroDoContrato(
        participantes.connect(ambiente.intruso).habilitar(await ambiente.endereco("fiador"), PAPEL.REGISTRADOR),
        participantes,
        "E_SEM_GOVERNANCA"
      );
    });
  });

  describe("controle de escrita no ledger", () => {
    it("quem nao e participante ativo nao ancora nem com papel local", async () => {
      const { ambiente } = await loadFixture(implantarConsorcio);

      await ambiente.contrato.concederRegistrador(await ambiente.endereco("intruso"));

      await esperarErroDoContrato(
        ancorarContrato(ambiente, { signer: "intruso" }),
        ambiente.contrato,
        "E_NAO_PARTICIPANTE"
      );
      expect(await ambiente.contrato.totalContratos()).to.equal(0n);
    });

    it("uma parte habilitada com papel local de registrador continua barrada", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);

      await ambiente.contrato.concederRegistrador(await ambiente.endereco("fiador"));
      await participantes.connect(ambiente.admin).habilitar(await ambiente.endereco("fiador"), PAPEL.PARTE);

      await esperarErroDoContrato(
        ancorarContrato(ambiente, { signer: "fiador" }),
        ambiente.contrato,
        "E_NAO_PARTICIPANTE"
      );
    });

    it("o registrador ativo ancora normalmente", async () => {
      const { ambiente } = await loadFixture(implantarConsorcio);
      await ancorarContrato(ambiente);
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });

    it("papel no consorcio sem registrador no ledger ainda e barrado", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);
      const fiador = await ambiente.endereco("fiador");

      await participantes.connect(ambiente.admin).habilitar(fiador, PAPEL.REGISTRADOR);
      expect(await participantes.podeAncorar(fiador)).to.equal(true);

      await esperarErroDoContrato(ancorarContrato(ambiente, { signer: "fiador" }), ambiente.contrato, "E_UNAUTHORIZED");

      await ambiente.contrato.concederRegistrador(fiador);
      await ancorarContrato(ambiente, { signer: "fiador" });
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });
  });

  describe("ex-cliente", () => {
    it("deixa de ancorar mas mantem o historico", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);
      const outro = await ambiente.endereco("outroRegistrador");

      await ancorarContrato(ambiente, { signer: "outroRegistrador", contratoId: "2026/0002" });
      expect(await ambiente.contrato.contratosDoRegistrador(outro)).to.have.lengthOf(1);

      await participantes.connect(ambiente.admin).tornarExCliente(outro);

      expect(await participantes.podeAncorar(outro)).to.equal(false);
      const [, situacao] = await participantes.papelDe(outro);
      expect(situacao).to.equal(SITUACAO.EXCLIENTE);

      await esperarErroDoContrato(
        ancorarContrato(ambiente, { signer: "outroRegistrador", contratoId: "2026/0003" }),
        ambiente.contrato,
        "E_NAO_PARTICIPANTE"
      );
      expect(await ambiente.contrato.contratosDoRegistrador(outro)).to.have.lengthOf(1);
    });

    it("reativar devolve o direito de ancorar", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);
      const outro = await ambiente.endereco("outroRegistrador");

      await participantes.connect(ambiente.admin).tornarExCliente(outro);
      await participantes.connect(ambiente.admin).reativar(outro);

      expect(await participantes.podeAncorar(outro)).to.equal(true);
      await ancorarContrato(ambiente, { signer: "outroRegistrador", contratoId: "2026/0002" });
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });
  });

  describe("governanca", () => {
    it("nao permite remover a ultima governanca", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);

      await esperarErroDoContrato(
        participantes.connect(ambiente.admin).revogarGovernanca(await ambiente.endereco("admin")),
        participantes,
        "E_GOVERNANCA_MINIMA"
      );
    });

    it("permite trocar governanca desde que sobre uma", async () => {
      const { ambiente, participantes } = await loadFixture(implantarConsorcio);
      const admin = await ambiente.endereco("admin");
      const outro = await ambiente.endereco("outroRegistrador");

      await participantes.connect(ambiente.admin).concederGovernanca(outro);
      await participantes.connect(ambiente.admin).revogarGovernanca(admin);

      expect(await participantes.podeAncorar(admin)).to.equal(false);
      expect(await participantes.podeAncorar(outro)).to.equal(true);
    });
  });

  describe("indice reverso por parte", () => {
    it("indexa cada parte do contrato", async () => {
      const { ambiente } = await loadFixture(implantarConsorcio);
      const { chave } = await ancorarContrato(ambiente);

      for (const nome of ["imobiliaria", "locador", "locatario"] as const) {
        const contratos = await ambiente.contrato.contratosDaParte(await ambiente.endereco(nome));
        expect(contratos).to.deep.equal([chave]);
      }

      expect(await ambiente.contrato.contratosDaParte(await ambiente.endereco("intruso"))).to.deep.equal([]);
    });
  });

  describe("compatibilidade", () => {
    it("sem controlador definido o comportamento legado permanece", async () => {
      const ambiente = await loadFixture(implantarRegistry);

      expect(await ambiente.contrato.controladorDeAcesso()).to.equal("0x0000000000000000000000000000000000000000");
      await ancorarContrato(ambiente);
      expect(await ambiente.contrato.totalContratos()).to.equal(1n);
    });
  });
});
