import { expect } from "chai";
import type { AddressInfo } from "node:net";
import { ServicoDeAncoragem } from "../registry/src/aplicacao/servico-de-ancoragem";
import { ServicoDeAutenticacao } from "../registry/src/aplicacao/servico-de-autenticacao";
import type { PortaLedger } from "../registry/src/aplicacao/porta-ledger";
import { PedidoDeChaveApi } from "../registry/src/dominio/dto/pedido-chave-api";
import { PedidoDeLogin } from "../registry/src/dominio/dto/pedido-login";
import { ErroAplicacao } from "../registry/src/dominio/erro";
import { RepositorioDeChaves } from "../registry/src/infra/repositorio-chaves";
import { SegurancaNode, conferirSenha, gerarChaveApi, gerarHashDeSenha, hashDeChaveApi, assinarToken, verificarToken } from "../registry/src/infra/seguranca";
import { criarApp } from "../registry/src/http/servidor";
import { abrirBancoDeTeste } from "./registry-test-database";
import { Pool } from "pg";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const USUARIO = "admin";
const SENHA = "senha-de-teste-forte";

function ledgerFalso(): PortaLedger {
  const recusar = async (): Promise<never> => {
    throw new Error("a ledger nao deveria ser chamada nos testes de autenticacao");
  };

  return {
    registrarContrato: recusar,
    registrarAssinatura: recusar,
    registrarAditivo: recusar,
    registrarVistoria: recusar,
    existeContrato: async () => false,
    consultarContrato: recusar,
    consultarPartes: recusar,
    contratosDaParte: recusar,
    consultarAssinaturas: recusar,
    consultarHistorico: recusar,
    verificarIntegridade: recusar,
    verificarRede: async () => ({ nome: "fake", chainId: 0, chainIdEsperado: 0, confere: true }),
    saude: async () => ({ status: "ok", nomeChain: "fake", chainId: 0, chainIdEsperado: 0, enderecoContrato: "0x0", alturaBloco: 0 }),
  } as unknown as PortaLedger;
}

describe("seguranca - senha, token e chave de api", () => {
  it("confere a senha correta e recusa a incorreta", () => {
    const armazenado = gerarHashDeSenha(SENHA);

    expect(armazenado).to.not.include(SENHA);
    expect(conferirSenha(SENHA, armazenado)).to.equal(true);
    expect(conferirSenha("outra-senha", armazenado)).to.equal(false);
  });

  it("assina um token que verifica, e recusa adulterado ou expirado", () => {
    const { token } = assinarToken(USUARIO, SEGREDO, 3600);
    const claims = verificarToken(token, SEGREDO);

    expect(claims?.sub).to.equal(USUARIO);
    expect(claims?.tipo).to.equal("admin");
    expect(verificarToken(token, "outro-segredo-de-32-caracteres-xxxxxxxx")).to.equal(null);
    expect(verificarToken(`${token}x`, SEGREDO)).to.equal(null);
    expect(verificarToken(assinarToken(USUARIO, SEGREDO, -1).token, SEGREDO)).to.equal(null);
  });

  it("gera chaves de api unicas e guarda apenas o hash", () => {
    const primeira = gerarChaveApi();
    const segunda = gerarChaveApi();

    expect(primeira).to.not.equal(segunda);
    expect(primeira.startsWith("moby_")).to.equal(true);
    expect(hashDeChaveApi(primeira)).to.equal(hashDeChaveApi(primeira));
    expect(hashDeChaveApi(primeira)).to.not.equal(primeira);
  });
});

describe("servico de autenticacao", () => {
  async function montar(): Promise<{ servico: ServicoDeAutenticacao; pool: Pool }> {
    const pool = await abrirBancoDeTeste();
    const chaves = new RepositorioDeChaves(pool);
    const seguranca = new SegurancaNode(SEGREDO);
    const admin = { usuario: USUARIO, senhaHash: gerarHashDeSenha(SENHA) };

    return { servico: new ServicoDeAutenticacao(chaves, seguranca, admin, 3600), pool };
  }

  afterEach(async () => {
    // Cleanup will be handled by the test runner
  });

  it("faz login e devolve um token Bearer valido", async () => {
    const { servico, pool } = await montar();
    try {
      const login = await servico.login(PedidoDeLogin.deJson({ usuario: USUARIO, senha: SENHA }));

      expect(login.tipo).to.equal("Bearer");
      expect(servico.verificarToken(login.token)?.sub).to.equal(USUARIO);
    } finally {
      await pool.end();
    }
  });

  it("recusa login com credencial errada sem revelar qual campo errou", async () => {
    const { servico, pool } = await montar();
    try {
      for (const corpo of [{ usuario: USUARIO, senha: "errada" }, { usuario: "outro", senha: SENHA }]) {
        try {
          await servico.login(PedidoDeLogin.deJson(corpo));
          expect.fail("deveria ter recusado");
        } catch (erro) {
          expect(erro).to.be.instanceOf(ErroAplicacao);
          expect((erro as ErroAplicacao).codigo).to.equal("CREDENCIAIS_INVALIDAS");
          expect((erro as ErroAplicacao).status).to.equal(401);
        }
      }
    } finally {
      await pool.end();
    }
  });

  it("emite uma chave, autentica com ela e registra o uso", async () => {
    const { servico, pool } = await montar();
    try {
      const { chave, registro } = await servico.criarChaveApi(PedidoDeChaveApi.deJson({ nome: "laravel" }));

      expect(registro.prefixo).to.equal(chave.slice(0, 12));
      expect(registro.endereco).to.equal(null);

      const autenticada = await servico.autenticarChaveApi(chave);
      expect(autenticada).to.not.equal(null);
      expect(autenticada?.endereco).to.equal(null);
      expect(await servico.autenticarChaveApi(`${chave}errada`)).to.equal(null);

      const [listada] = await servico.listarChaves();
      expect(listada?.ultimaUtilizacaoEm).to.not.equal(null);
    } finally {
      await pool.end();
    }
  });

  it("vincula a chave a um endereco de parte, normalizado", async () => {
    const { servico, pool } = await montar();
    try {
      const endereco = "0xAbC0000000000000000000000000000000000001";
      const { chave, registro } = await servico.criarChaveApi(PedidoDeChaveApi.deJson({ nome: "locatario", endereco }));

      expect(registro.endereco).to.equal(endereco.toLowerCase());

      const autenticada = await servico.autenticarChaveApi(chave);
      expect(autenticada?.endereco).to.equal(endereco.toLowerCase());
    } finally {
      await pool.end();
    }
  });

  it("a revogacao invalida a chave e e idempotente em erro", async () => {
    const { servico, pool } = await montar();
    try {
      const { chave, registro } = await servico.criarChaveApi(PedidoDeChaveApi.deJson({ nome: "sistema" }));

      await servico.revogarChave(registro.id);
      expect(await servico.autenticarChaveApi(chave)).to.equal(null);

      try {
        await servico.revogarChave(registro.id);
        expect.fail("deveria ter recusado a segunda revogacao");
      } catch (erro) {
        expect((erro as ErroAplicacao).codigo).to.equal("CHAVE_NAO_ENCONTRADA");
      }
    } finally {
      await pool.end();
    }
  });

  it("nao autentica chave com prazo vencido", async () => {
    const { servico, pool } = await montar();
    try {
      const passado = new Date(Date.now() - 60_000).toISOString();
      const { chave } = await servico.criarChaveApi(PedidoDeChaveApi.deJson({ nome: "expirada", expiraEm: passado }));

      expect(await servico.autenticarChaveApi(chave)).to.equal(null);
    } finally {
      await pool.end();
    }
  });
});

function ledgerDeEscopo(partes: string[], contratoDoEndereco: string[]): PortaLedger {
  return {
    registrarContrato: async () => {
      throw new Error("nao deveria escrever");
    },
    registrarAssinatura: async () => {
      throw new Error("nao deveria escrever");
    },
    registrarAditivo: async () => {
      throw new Error("nao deveria escrever");
    },
    registrarVistoria: async () => {
      throw new Error("nao deveria escrever");
    },
    existeContrato: async () => true,
    consultarContrato: async () => ({
      status: 0,
      registroPor: "0x0000000000000000000000000000000000000000",
      registradoEm: 0,
      bloco: 0,
      hashDocumento: "0x" + "00".repeat(32),
      deterministicHash: "0x" + "00".repeat(32),
      deterministicHashV2: "0x" + "00".repeat(32),
      prazoVigenciaDias: 365,
      indiceReajuste: 0,
      tipoHash: 0,
      partes,
    }),
    consultarPartes: async () => partes,
    contratosDaParte: async () => contratoDoEndereco,
    consultarAssinaturas: async () => ({}),
    consultarHistorico: async () => [],
    verificarIntegridade: async () => ({ integro: true, hashAncorado: "0x" + "00".repeat(32) }),
    consultarTransacao: async () => null,
    verificarRede: async () => ({ nome: "fake", chainId: 0, chainIdEsperado: 0, confere: true }),
    saude: async () => ({ status: "ok", nomeChain: "fake", chainId: 0, chainIdEsperado: 0, enderecoContrato: "0x0", alturaBloco: 0, timestamp: new Date().toISOString() }),
  };
}

describe("http - login e gestao de api keys", () => {
  async function subirApp(ledger: PortaLedger = ledgerFalso()): Promise<{ baseUrl: string; fechar: () => Promise<void>; pool: Pool }> {
    const pool = await abrirBancoDeTeste();
    const seguranca = new SegurancaNode(SEGREDO);
    const servico = new ServicoDeAutenticacao(new RepositorioDeChaves(pool), seguranca, { usuario: USUARIO, senhaHash: gerarHashDeSenha(SENHA) }, 3600);
    const app = criarApp(new ServicoDeAncoragem(ledger), { autenticacao: servico });

    const servidor = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => servidor.once("listening", resolve));
    const { port } = servidor.address() as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
      pool,
    };
  }

  async function pedir(baseUrl: string, rota: string, init?: RequestInit): Promise<{ status: number; corpo: any }> {
    const resposta = await fetch(`${baseUrl}${rota}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    return { status: resposta.status, corpo: resposta.status === 204 ? null : await resposta.json() };
  }

  it("exige token nas rotas de administracao", async () => {
    const { baseUrl, fechar, pool } = await subirApp();
    try {
      const { status, corpo } = await pedir(baseUrl, "/api-keys");
      expect(status).to.equal(401);
      expect(corpo.erro.codigo).to.equal("TOKEN_AUSENTE");
    } finally {
      await fechar();
      await pool.end();
    }
  });

  it("faz login e usa o token para emitir uma chave que autentica a ancoragem", async () => {
    const { baseUrl, fechar, pool } = await subirApp();
    try {
      const login = await pedir(baseUrl, "/auth/login", { method: "POST", body: JSON.stringify({ usuario: USUARIO, senha: SENHA }) });
      expect(login.status).to.equal(200);

      const emissao = await pedir(baseUrl, "/api-keys", {
        method: "POST",
        headers: { authorization: `Bearer ${login.corpo.token}` },
        body: JSON.stringify({ nome: "laravel-producao" }),
      });
      expect(emissao.status).to.equal(201);
      expect(emissao.corpo.chave.startsWith("moby_")).to.equal(true);

      const sem = await pedir(baseUrl, "/contratos/2026/0001");
      expect(sem.status).to.equal(401);

      const comChave = await pedir(baseUrl, "/contratos/2026/0001", { headers: { "x-api-key": emissao.corpo.chave } });
      expect(comChave.status).to.equal(409);
      expect(comChave.corpo.erro.codigo).to.equal("CONTRATO_NAO_ANCORADO");
    } finally {
      await fechar();
      await pool.end();
    }
  });

  it("escopa a leitura pela parte vinculada a chave", async () => {
    const parte = "0xabc0000000000000000000000000000000000001";
    const outra = "0xdef0000000000000000000000000000000000002";
    const { baseUrl, fechar, pool } = await subirApp(ledgerDeEscopo([parte], ["0x" + "11".repeat(32)]));

    try {
      const login = await pedir(baseUrl, "/auth/login", { method: "POST", body: JSON.stringify({ usuario: USUARIO, senha: SENHA }) });
      const autorizacao = { authorization: `Bearer ${login.corpo.token}` };

      const emitir = async (nome: string, endereco?: string) =>
        pedir(baseUrl, "/api-keys", { method: "POST", headers: autorizacao, body: JSON.stringify({ nome, endereco }) });

      const chaveParte = await emitir("locatario", parte);
      const chaveOutra = await emitir("estranho", outra);
      const chaveSem = await emitir("sem-escopo");

      const meus = await pedir(baseUrl, "/meus-contratos", { headers: { "x-api-key": chaveParte.corpo.chave } });
      expect(meus.status).to.equal(200);
      expect(meus.corpo.endereco).to.equal(parte);
      expect(meus.corpo.contratos).to.have.lengthOf(1);

      const proprio = await pedir(baseUrl, "/contratos/2026/0001", { headers: { "x-api-key": chaveParte.corpo.chave } });
      expect(proprio.status).to.equal(200);

      const alheio = await pedir(baseUrl, "/contratos/2026/0001", { headers: { "x-api-key": chaveOutra.corpo.chave } });
      expect(alheio.status).to.equal(403);
      expect(alheio.corpo.erro.codigo).to.equal("ACESSO_NEGADO");

      const semEscopo = await pedir(baseUrl, "/meus-contratos", { headers: { "x-api-key": chaveSem.corpo.chave } });
      expect(semEscopo.status).to.equal(403);
      expect(semEscopo.corpo.erro.codigo).to.equal("CHAVE_SEM_ENDERECO");
    } finally {
      await fechar();
      await pool.end();
    }
  });
});
