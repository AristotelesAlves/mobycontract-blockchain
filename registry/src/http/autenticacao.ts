import type { NextFunction, Request, Response } from "express";
import type { ClaimsDeToken } from "../aplicacao/porta-seguranca";

/**
 * Middlewares de autenticacao da camada HTTP.
 *
 * Duas credenciais diferentes, dois papeis diferentes:
 *  - API key (`x-api-key`) autentica as rotas de ancoragem e consulta;
 *  - token JWT (`Authorization: Bearer`) autentica o administrador que gerencia
 *    as API keys.
 *
 * A resposta de 401 nao usa o envelope completo de `ErroAplicacao`: e uma
 * decisao de transporte, nao de dominio. Mantem o codigo historico
 * `CHAVE_INVALIDA`, que o Laravel ja traduz.
 */

export interface ContextoDeChaveApi {
  endereco: string | null;
}

export interface OpcoesDeChaveApi {
  chaveApi?: string;
  rotasPublicas: ReadonlySet<string>;
  verificarChaveApi?: (chave: string) => Promise<ContextoDeChaveApi | null>;
}

export interface RequisicaoAutenticada extends Request {
  claims?: ClaimsDeToken;
}

export function enderecoDaChave(res: Response): string | null {
  return (res.locals.enderecoParte as string | null | undefined) ?? null;
}

export function definirEnderecoDaChave(res: Response, endereco: string | null): void {
  res.locals.enderecoParte = endereco;
}

function chaveInvalida(res: Response): void {
  res.status(401).json({ erro: { familia: "AUTENTICACAO", codigo: "CHAVE_INVALIDA", mensagem: "chave de api ausente ou incorreta", detalhe: {} } });
}

function tokenAusente(res: Response): void {
  res.status(401).json({ erro: { familia: "AUTENTICACAO", codigo: "TOKEN_AUSENTE", mensagem: "informe o token Bearer no cabecalho authorization", detalhe: {} } });
}

function tokenInvalido(res: Response): void {
  res.status(401).json({ erro: { familia: "AUTENTICACAO", codigo: "TOKEN_INVALIDO", mensagem: "token ausente, expirado ou invalido", detalhe: {} } });
}

export function autenticacaoPorChaveApi(opcoes: OpcoesDeChaveApi) {
  const configuravel = Boolean(opcoes.chaveApi) || Boolean(opcoes.verificarChaveApi);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (opcoes.rotasPublicas.has(req.path)) {
      next();
      return;
    }

    if (!configuravel) {
      chaveInvalida(res);
      return;
    }

    const apresentada = req.header("x-api-key");
    if (opcoes.chaveApi && apresentada === opcoes.chaveApi) {
      definirEnderecoDaChave(res, null);
      next();
      return;
    }

    if (!apresentada || !opcoes.verificarChaveApi) {
      chaveInvalida(res);
      return;
    }

    opcoes
      .verificarChaveApi(apresentada)
      .then((contexto) => {
        if (!contexto) {
          chaveInvalida(res);
          return;
        }
        definirEnderecoDaChave(res, contexto.endereco);
        next();
      })
      .catch(next);
  };
}

export function exigirTokenAdmin(verificarToken: (token: string) => ClaimsDeToken | null) {
  return (req: RequisicaoAutenticada, res: Response, next: NextFunction): void => {
    const [tipo, token] = (req.header("authorization") ?? "").split(" ");

    if (tipo?.toLowerCase() !== "bearer" || !token) {
      tokenAusente(res);
      return;
    }

    const claims = verificarToken(token);
    if (!claims || claims.tipo !== "admin") {
      tokenInvalido(res);
      return;
    }

    req.claims = claims;
    next();
  };
}
