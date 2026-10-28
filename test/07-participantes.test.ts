import { expect } from "chai";
import { Wallet } from "ethers";
import type { AddressInfo } from "node:net";
import { ServicoDeAncoragem } from "../registry/src/aplicacao/servico-de-ancoragem";
import { ServicoDeAutenticacao } from "../registry/src/aplicacao/servico-de-autenticacao";
import type { PortaParticipantes } from "../registry/src/aplicacao/porta-participantes";
import type { PortaLedger } from "../registry/src/aplicacao/porta-ledger";
import { ServicoDeParticipantes } from "../registry/src/aplicacao/servico-de-participantes";
import { PedidoDeParticipante, PedidoDeRemocao } from "../registry/src/dominio/dto/pedido-participante";
import { ErroAplicacao } from "../registry/src/dominio/erro";
import { editarAllowlistDeContas, extrairChavePrivada, montarYamlDaChave } from "../registry/src/infra/administracao-de-participantes";
import { RepositorioDeChaves } from "../registry/src/infra/repositorio-chaves";
import { SegurancaNode, gerarHashDeSenha } from "../registry/src/infra/seguranca";
import { criarApp } from "../registry/src/http/servidor";
import { abrirBancoDeTeste } from "./registry-test-database";
import { Pool } from "pg";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const USUARIO = "admin";
const SENHA = "senha-de-teste-forte";
const CHAVE_CONHECIDA = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function portaFalsa(opcoes: { permissao?: boolean; chaves?: boolean; enderecos?: Record<string, string> } = {}) {
  const chamadas: string[] = [];
  const enderecos = opcoes.enderecos ?? {};
  const permissao = opcoes.permissao ?? true;
  const chaves = opcoes.chaves ?? true;
  const hash = (prefixo: string) => `0x${prefixo.repeat(32)}`;

  const porta: PortaParticipantes = {
    capacidade: () => ({ permissao, chaves }),
    derivarEndereco: (chavePrivada) => new Wallet(chavePrivada).address,
    publicarChave: async (nome, chavePrivada) => {
      chamadas.push(`chave+${nome}`);
      enderecos[nome] = new Wallet(chavePrivada).address;
      return enderecos[nome];
    },
    gerarChave: async (nome) => {
      chamadas.push(`chave-gerada:${nome}`);
      enderecos[nome] = "0x1111111111111111111111111111111111111111";
      return enderecos[nome];
    },
    enderecoDaChave: async (nome) => enderecos[nome] ?? null,
    removerChave: async (nome) => {
      chamadas.push(`chave-${nome}`);
      delete enderecos[nome];
    },
    adicionarNaAllowlist: async (endereco) => void chamadas.push(`allowlist+${endereco}`),
    removerDaAllowlist: async (endereco) => void chamadas.push(`allowlist-${endereco}`),
    habilitarNoConsorcio: async (endereco, papel) => {
      chamadas.push(`consorcio:${endereco}:${papel}`);
      return hash("aa");
    },
    encerrarNoConsorcio: async (endereco) => {
      chamadas.push(`encerrar:${endereco}`);
      return hash("bb");
    },
    concederRegistrador: async (endereco) => {
      chamadas.push(`registrador+${endereco}`);
      return hash("cc");
    },
    revogarRegistrador: async (endereco) => {
      chamadas.push(`registrador-${endereco}`);
      return hash("dd");
    },
    recarregarAssinador: async () => void chamadas.push("reload"),
  };

  return { porta, chamadas, enderecos };
}

describe("administracao de participantes - service", () => {
  it("admite um registrador gerando a chave, com allowlist e as duas travas on-chain", async () => {
    const { porta, chamadas } = portaFalsa();
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.adicionar(PedidoDeParticipante.deJson({ nome: "ana", papel: "Registrador" }));

    expect(resultado.acoes).to.deep.equal(["chave-gerada", "allowlist", "consorcio", "registrador", "assinador-recarregado"]);
    expect(resultado.papel).to.equal(2);
    expect(resultado.endereco).to.equal("0x1111111111111111111111111111111111111111");
    expect(chamadas).to.include("registrador+0x1111111111111111111111111111111111111111");
    expect(resultado.transacoes.registrador).to.match(/^0x/);
  });

  it("admite uma parte sem conceder registrador no ledger", async () => {
    const { porta, chamadas } = portaFalsa();
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.adicionar(PedidoDeParticipante.deJson({ nome: "cliente", papel: "Parte" }));

    expect(resultado.papel).to.equal(3);
    expect(resultado.acoes).to.deep.equal(["chave-gerada", "allowlist", "consorcio", "assinador-recarregado"]);
    expect(chamadas.some((c) => c.startsWith("registrador+"))).to.equal(false);
  });

  it("publica a chave fornecida e deriva o endereco sem gerar outra", async () => {
    const { porta, chamadas } = portaFalsa();
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.adicionar(PedidoDeParticipante.deJson({ nome: "ana", papel: "Registrador", chavePrivada: CHAVE_CONHECIDA }));

    expect(resultado.endereco).to.equal(new Wallet(CHAVE_CONHECIDA).address);
    expect(resultado.acoes).to.contain("chave-publicada");
    expect(chamadas).to.contain("chave+ana");
  });

  it("pula allowlist e assinador quando o ambiente nao tem essas capacidades", async () => {
    const { porta, chamadas } = portaFalsa({ permissao: false, chaves: false });
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.adicionar(PedidoDeParticipante.deJson({ nome: "ee", papel: "Parte", endereco: "0x2222222222222222222222222222222222222222" }));

    expect(resultado.acoes).to.deep.equal(["consorcio"]);
    expect(chamadas).to.deep.equal(["consorcio:0x2222222222222222222222222222222222222222:3"]);
  });

  it("recusa admissao sem destino quando nao ha keystore para gerar a chave", async () => {
    const { porta } = portaFalsa({ chaves: false });
    const servico = new ServicoDeParticipantes(porta);

    try {
      await servico.adicionar(PedidoDeParticipante.deJson({ nome: "sem-destino" }));
      expect.fail("deveria ter recusado");
    } catch (erro) {
      expect((erro as ErroAplicacao).codigo).to.equal("DESTINO_AUSENTE");
    }
  });

  it("remove por nome disparando encerramento, revogacao e descarte da chave", async () => {
    const alvo = "0x3333333333333333333333333333333333333333";
    const { porta, chamadas } = portaFalsa({ enderecos: { ana: alvo } });
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.remover(PedidoDeRemocao.deIdentificador("ana"));

    expect(resultado.endereco).to.equal(alvo);
    expect(resultado.acoes).to.deep.equal(["allowlist", "consorcio-encerrado", "registrador-revogado", "chave-removida", "assinador-recarregado"]);
    expect(chamadas).to.contain("encerrar:0x3333333333333333333333333333333333333333");
    expect(chamadas).to.contain("registrador-0x3333333333333333333333333333333333333333");
  });

  it("remove por endereco sem tocar no keystore", async () => {
    const { porta, chamadas } = portaFalsa();
    const servico = new ServicoDeParticipantes(porta);

    const resultado = await servico.remover(PedidoDeRemocao.deIdentificador("0x4444444444444444444444444444444444444444"));

    expect(resultado.acoes).to.deep.equal(["allowlist", "consorcio-encerrado", "registrador-revogado"]);
    expect(chamadas.some((c) => c.startsWith("chave-"))).to.equal(false);
  });

  it("nao encontra participante por nome quando nao ha keystore para resolver", async () => {
    const { porta } = portaFalsa({ chaves: false });
    const servico = new ServicoDeParticipantes(porta);

    try {
      await servico.remover(PedidoDeRemocao.deIdentificador("fantasma"));
      expect.fail("deveria ter recusado");
    } catch (erro) {
      expect((erro as ErroAplicacao).codigo).to.equal("PARTICIPANTE_NAO_ENCONTRADO");
    }
  });

  it("rejeita identificador de remocao invalido", () => {
    try {
      PedidoDeRemocao.deIdentificador("nome com espaco");
      expect.fail("deveria ter recusado");
    } catch (erro) {
      expect((erro as ErroAplicacao).codigo).to.equal("IDENTIFICADOR_INVALIDO");
    }
  });
});

describe("administracao de participantes - helpers de infra", () => {
  it("adiciona e remove endereco da allowlist preservando os demais", () => {
    const original = 'accounts-allowlist = ["0xaaa0000000000000000000000000000000000001"]\n';
    const adicionado = editarAllowlistDeContas(original, "0xBBB0000000000000000000000000000000000002", "adicionar");

    expect(adicionado).to.include('"0xbbb0000000000000000000000000000000000002"');
    expect(adicionado).to.include('"0xaaa0000000000000000000000000000000000001"');

    const removido = editarAllowlistDeContas(adicionado, "0xaaa0000000000000000000000000000000000001", "remover");
    expect(removido).to.not.include("0xaaa0000000000000000000000000000000000001");
  });

  it("serializa e relê a chave no formato file-raw do Web3Signer", () => {
    const yaml = montarYamlDaChave(CHAVE_CONHECIDA);

    expect(yaml).to.include('type: "file-raw"');
    expect(yaml).to.include('keyType: "SECP256K1"');
    expect(extrairChavePrivada(yaml)).to.equal(CHAVE_CONHECIDA);
    expect(extrairChavePrivada("sem chave")).to.equal(null);
  });
});

function ledgerDeParticipantes(): PortaLedger {
  const recusar = async (): Promise<never> => {
    throw new Error("a ledger nao deveria ser chamada nos testes de participantes");
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
    consultarTransacao: recusar,
    verificarRede: async () => ({ nome: "fake", chainId: 0, chainIdEsperado: 0, confere: true }),
    saude: async () => ({ status: "ok", nomeChain: "fake", chainId: 0, chainIdEsperado: 0, enderecoContrato: "0x0", alturaBloco: 0, timestamp: new Date().toISOString() }),
  };
}

describe("http - admissao e remocao de participantes", () => {
  async function subirApp() {
    const { porta, chamadas } = portaFalsa();
    const pool = await abrirBancoDeTeste();
    const seguranca = new SegurancaNode(SEGREDO);
    const autenticacao = new ServicoDeAutenticacao(new RepositorioDeChaves(pool), seguranca, { usuario: USUARIO, senhaHash: gerarHashDeSenha(SENHA) }, 3600);
    const participantes = new ServicoDeParticipantes(porta);
    const app = criarApp(new ServicoDeAncoragem(ledgerDeParticipantes()), { autenticacao, participantes });

    const servidor = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => servidor.once("listening", resolve));
    const { port } = servidor.address() as AddressInfo;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      chamadas,
      fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
      pool,
    };
  }

  async function pedir(baseUrl: string, rota: string, init?: RequestInit): Promise<{ status: number; corpo: any }> {
    const resposta = await fetch(`${baseUrl}${rota}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    return { status: resposta.status, corpo: resposta.status === 204 ? null : await resposta.json() };
  }

  async function tokenDe(baseUrl: string): Promise<string> {
    const login = await pedir(baseUrl, "/auth/login", { method: "POST", body: JSON.stringify({ usuario: USUARIO, senha: SENHA }) });
    return login.corpo.token;
  }

  it("exige token Bearer nas rotas de participantes", async () => {
    const { baseUrl, fechar, pool } = await subirApp();
    try {
      const { status, corpo } = await pedir(baseUrl, "/participantes", { method: "POST", body: JSON.stringify({ nome: "ana" }) });
      expect(status).to.equal(401);
      expect(corpo.erro.codigo).to.equal("TOKEN_AUSENTE");
    } finally {
      await fechar();
      await pool.end();
    }
  });

  it("admite um participante e devolve 201 com o efeito", async () => {
    const { baseUrl, chamadas, fechar, pool } = await subirApp();
    try {
      const token = await tokenDe(baseUrl);
      const { status, corpo } = await pedir(baseUrl, "/participantes", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: "locataria", papel: "Registrador", endereco: "0x5555555555555555555555555555555555555555" }),
      });

      expect(status).to.equal(201);
      expect(corpo.endereco).to.equal("0x5555555555555555555555555555555555555555");
      expect(corpo.papelNome).to.equal("Registrador");
      expect(corpo.acoes).to.include("consorcio");
      expect(chamadas).to.include("registrador+0x5555555555555555555555555555555555555555");
    } finally {
      await fechar();
      await pool.end();
    }
  });

  it("remove um participante por endereco e devolve 200", async () => {
    const { baseUrl, chamadas, fechar, pool } = await subirApp();
    try {
      const token = await tokenDe(baseUrl);
      const { status, corpo } = await pedir(baseUrl, "/participantes/0x6666666666666666666666666666666666666666", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(status).to.equal(200);
      expect(corpo.endereco).to.equal("0x6666666666666666666666666666666666666666");
      expect(corpo.acoes).to.include("consorcio-encerrado");
      expect(chamadas).to.include("encerrar:0x6666666666666666666666666666666666666666");
    } finally {
      await fechar();
      await pool.end();
    }
  });

  it("recusa corpo invalido com 422", async () => {
    const { baseUrl, fechar, pool } = await subirApp();
    try {
      const token = await tokenDe(baseUrl);
      const { status, corpo } = await pedir(baseUrl, "/participantes", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome: "nome invalido!" }),
      });

      expect(status).to.equal(422);
      expect(corpo.erro.codigo).to.equal("ENTRADA_INVALIDA");
    } finally {
      await fechar();
      await pool.end();
    }
  });
});
