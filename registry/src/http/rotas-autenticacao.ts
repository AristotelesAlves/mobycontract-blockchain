import type { Request, RequestHandler, Response, Router } from "express";
import { Router as criarRouter } from "express";
import type { ServicoDeAutenticacao } from "../aplicacao/servico-de-autenticacao";
import { PedidoDeChaveApi } from "../dominio/dto/pedido-chave-api";
import { PedidoDeLogin } from "../dominio/dto/pedido-login";
import { rota } from "./rotas";

/**
 * Rotas de autenticacao e gestao de API keys.
 *
 * `/auth/login` e publica. As demais exigem o token do administrador, aplicado
 * por `exigirTokenAdmin` antes de chegar aqui. A API key completa so aparece na
 * resposta da criacao - depois, so o prefixo.
 */

function idDaUrl(req: Request): number {
  return Number(req.params.id);
}

export function criarRotasDeAutenticacao(servico: ServicoDeAutenticacao, exigirToken: RequestHandler): Router {
  const rotas = criarRouter();

  rotas.post(
    "/auth/login",
    rota(async (req: Request, res: Response) => {
      res.json(await servico.login(PedidoDeLogin.deJson(req.body)));
    })
  );

  rotas.get(
    "/api-keys",
    exigirToken,
    rota(async (_req: Request, res: Response) => {
      res.json({ chaves: await servico.listarChaves() });
    })
  );

  rotas.post(
    "/api-keys",
    exigirToken,
    rota(async (req: Request, res: Response) => {
      const { chave, registro } = await servico.criarChaveApi(PedidoDeChaveApi.deJson(req.body));
      res.status(201).json({ chave, ...registro });
    })
  );

  rotas.delete(
    "/api-keys/:id",
    exigirToken,
    rota(async (req: Request, res: Response) => {
      await servico.revogarChave(idDaUrl(req));
      res.status(204).end();
    })
  );

  return rotas;
}
