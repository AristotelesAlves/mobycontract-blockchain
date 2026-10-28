import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ErroAplicacao } from "../dominio/erro";
import { log } from "../infra/log";
import { familiaDoRevert, nomeDoRevertDoContrato } from "../infra/reverts";

/**
 * Traducao de erro para HTTP.
 *
 * Tres origens, uma unica resposta: erro de aplicacao, erro de validacao do
 * zod e revert do contrato. O corpo nunca carrega stack trace - um stack trace
 * em resposta de erro revela caminho de arquivo e versao de biblioteca.
 */

type MiddlewareDeErro = (erro: unknown, req: Request, res: Response, next: NextFunction) => void;

function erroDeValidacao(issues: z.ZodIssue[]): Record<string, unknown> {
  return { erro: { familia: "VALIDACAO", codigo: "ENTRADA_INVALIDA", mensagem: "a entrada nao passou na validacao", detalhe: { campos: issues.map((i) => ({ campo: i.path.join("."), problema: i.message })) } } };
}

type CorpoDeErro = { erro: { familia: "NEGOCIO" | "VALIDACAO"; codigo: string; mensagem: string; detalhe: Record<string, unknown> } };

function erroDeRevert(erro: unknown): CorpoDeErro | null {
  const familia = familiaDoRevert(erro);
  if (!familia) return null;

  const motivo = nomeDoRevertDoContrato(erro)!;
  return {
    erro: {
      familia,
      codigo: familia === "NEGOCIO" ? "FALHA_CONTRATO" : "ENTRADA_INVALIDA",
      mensagem: `o contrato recusou a operacao: ${motivo}`,
      detalhe: { motivo },
    },
  };
}

export const tratarErro: MiddlewareDeErro = (erro, _req, res, _next) => {
  if (erro instanceof ErroAplicacao) {
    res.status(erro.status).json(erro.toJSON());
    return;
  }

  if (erro instanceof z.ZodError) {
    res.status(422).json(erroDeValidacao(erro.issues));
    return;
  }

  const doContrato = erroDeRevert(erro);
  if (doContrato) {
    res.status(doContrato.erro.familia === "NEGOCIO" ? 409 : 422).json(doContrato);
    return;
  }

  log.error({ erro: erro instanceof Error ? erro.message : String(erro) }, "falha nao tratada");
  res.status(500).json({ erro: { familia: "INTERNO", codigo: "FALHA_INTERNA", mensagem: "falha ao processar a requisicao", detalhe: {} } });
};