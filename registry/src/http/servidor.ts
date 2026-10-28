import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { ServicoDeAncoragem } from "../aplicacao/servico-de-ancoragem";
import type { ServicoDeAutenticacao } from "../aplicacao/servico-de-autenticacao";
import type { ServicoDeParticipantes } from "../aplicacao/servico-de-participantes";
import { log } from "../infra/log";
import { autenticacaoPorChaveApi, exigirTokenAdmin } from "./autenticacao";
import { tratarErro } from "./erro-http";
import { criarRotas } from "./rotas";
import { criarRotasDeAutenticacao } from "./rotas-autenticacao";
import { criarRotasDeParticipantes } from "./rotas-participantes";

/**
 * Composicao do app HTTP: corpo, autenticacao, log, rotas, tratamento de erro.
 *
 * A autenticacao tem duas fronteiras. As rotas de administracao (`/auth/login`
 * e `/api-keys`) sao montadas antes do middleware de API key e protegidas por
 * token; o resto responde a uma API key, estatica (`CHAVE_API`) ou gerenciada
 * (emitida por `/api-keys`). Sem nenhuma fonte de credencial configurada, as
 * rotas protegidas sao negadas - nao abertas.
 */

export const LIMITE_DO_CORPO = "12mb";

export interface OpcoesApp {
  chaveApi?: string;
  rotasPublicas?: string[];
  autenticacao?: ServicoDeAutenticacao;
  participantes?: ServicoDeParticipantes;
}

function acessoRegistrado() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const inicio = Date.now();
    res.on("finish", () => log.info({ rota: req.path, metodo: req.method, status: res.statusCode, ms: Date.now() - inicio }, "requisicao"));
    next();
  };
}

export function criarApp(servico: ServicoDeAncoragem, opcoes: OpcoesApp = {}): Express {
  const app = express();
  const rotasPublicas = new Set(opcoes.rotasPublicas ?? ["/saude"]);
  const autenticacao = opcoes.autenticacao;

  app.use(express.json({ limit: LIMITE_DO_CORPO }));
  app.use(acessoRegistrado());

  const exigirToken = autenticacao
    ? exigirTokenAdmin((token) => autenticacao.verificarToken(token))
    : null;

  if (autenticacao && exigirToken) {
    app.use(criarRotasDeAutenticacao(autenticacao, exigirToken));
  }

  if (opcoes.participantes && exigirToken) {
    app.use(criarRotasDeParticipantes(opcoes.participantes, exigirToken));
  }

  app.use(
    autenticacaoPorChaveApi({
      chaveApi: opcoes.chaveApi,
      rotasPublicas,
      verificarChaveApi: autenticacao ? (chave) => autenticacao.autenticarChaveApi(chave) : undefined,
    })
  );

  app.use(criarRotas(servico));
  app.use(tratarErro);

  return app;
}
