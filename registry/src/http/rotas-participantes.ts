import type { Request, RequestHandler, Response, Router } from "express";
import { Router as criarRouter } from "express";
import type { ServicoDeParticipantes } from "../aplicacao/servico-de-participantes";
import { PedidoDeParticipante, PedidoDeRemocao } from "../dominio/dto/pedido-participante";
import { rota } from "./rotas";

/**
 * Rotas de administracao de participantes.
 *
 * Sao rotas de administracao: ficam atras do token Bearer (como `/auth/login` e
 * `/api-keys`), e nao da API key de ancoragem - admitir/remover membro muda quem
 * pode escrever no consorcio.
 *
 * `POST /participantes` admite (corpo com `nome`, `papel` e, opcionalmente,
 * `endereco`/`chavePrivada`); `DELETE /participantes/:identificador` remove,
 * aceitando nome ou endereco `0x`.
 */
export function criarRotasDeParticipantes(servico: ServicoDeParticipantes, exigirToken: RequestHandler): Router {
  const rotas = criarRouter();

  rotas.post(
    "/participantes",
    exigirToken,
    rota(async (req: Request, res: Response) => {
      res.status(201).json(await servico.adicionar(PedidoDeParticipante.deJson(req.body)));
    })
  );

  rotas.delete(
    "/participantes/:identificador",
    exigirToken,
    rota(async (req: Request, res: Response) => {
      res.json(await servico.remover(PedidoDeRemocao.deIdentificador(String(req.params.identificador))));
    })
  );

  return rotas;
}
