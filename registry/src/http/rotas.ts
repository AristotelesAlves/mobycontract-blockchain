import type { Request, Response, Router } from "express";
import { Router as criarRouter } from "express";
import type { ServicoDeAncoragem } from "../aplicacao/servico-de-ancoragem";
import { PedidoDeAditivo } from "../dominio/dto/pedido-aditivo";
import { PedidoDeAssinatura } from "../dominio/dto/pedido-assinatura";
import { PedidoDeContrato } from "../dominio/dto/pedido-contrato";
import { PedidoDeIntegridade } from "../dominio/dto/pedido-integridade";
import { PedidoDeVistoria } from "../dominio/dto/pedido-vistoria";
import { acessoNegadoAoContrato, chaveSemEndereco } from "../dominio/erro";
import { contratoIdOnChain } from "../../../src/chaves";
import { enderecoDaChave } from "./autenticacao";

/**
 * Rotas HTTP do registry service.
 *
 * Cada handler faz tres coisas e nenhuma a mais: transforma o corpo da
 * requisicao em DTO, chama um caso de uso e escreve a resposta. Todo o trabalho
 * de derivar hash, pseudonimizar e checar pre-condicao esta em
 * `ServicoDeAncoragem`.
 *
 * Nas escritas, o `endereco` da chave de API (quando houver) vai junto: e ele
 * que faz a transacao sair assinada pela parte no Web3Signer, em vez de pela
 * carteira do servico.
 */

type Manipulador = (req: Request, res: Response) => Promise<void>;

export function rota(manipulador: Manipulador) {
  return (req: Request, res: Response, next: (erro?: unknown) => void): void => {
    manipulador(req, res).catch(next);
  };
}

function contratoIdDaUrl(req: Request): string {
  return String(req.params.contratoId);
}

export function criarRotas(servico: ServicoDeAncoragem): Router {
  const rotas = criarRouter();

  rotas.get(
    "/saude",
    rota(async (_req, res) => {
      res.json(await servico.saude());
    })
  );

  rotas.post(
    "/ancoras/contratos",
    rota(async (req, res) => {
      const ancora = await servico.ancorarContrato(PedidoDeContrato.deJson(req.body), enderecoDaChave(res));
      res.status(201).json(ancora);
    })
  );

  rotas.post(
    "/ancoras/assinaturas",
    rota(async (req, res) => {
      const ancora = await servico.registrarAssinatura(PedidoDeAssinatura.deJson(req.body), enderecoDaChave(res));
      res.status(201).json(ancora);
    })
  );

  rotas.post(
    "/ancoras/aditivos",
    rota(async (req, res) => {
      const ancora = await servico.ancorarAditivo(PedidoDeAditivo.deJson(req.body), enderecoDaChave(res));
      res.status(201).json(ancora);
    })
  );

  rotas.post(
    "/ancoras/vistorias",
    rota(async (req, res) => {
      const ancora = await servico.ancorarVistoria(PedidoDeVistoria.deJson(req.body), enderecoDaChave(res));
      res.status(201).json(ancora);
    })
  );

  rotas.post(
    "/contratos/:contratoId(.+)/integridade",
    rota(async (req, res) => {
      const contratoId = contratoIdDaUrl(req);
      const pedido = PedidoDeIntegridade.deJson(contratoId, req.body);
      const { integro, hashAncorado } = await servico.verificarIntegridade(pedido);

      res.json({ contratoId, chave: pedido.chave, integro, hashAncorado, hashInformado: pedido.documento.hash, verificadoEm: new Date().toISOString() });
    })
  );

  rotas.get(
    "/transacoes/:hash(0x[0-9a-fA-F]{64})",
    rota(async (req, res) => {
      const transacao = await servico.consultarTransacao(String(req.params.hash));
      if (!transacao) {
        res.status(404).json({ erro: { familia: "NEGOCIO", codigo: "TRANSACAO_NAO_ENCONTRADA", mensagem: "a transacao nao foi encontrada nesta rede", detalhe: {} } });
        return;
      }

      res.json(transacao);
    })
  );

  rotas.get(
    "/meus-contratos",
    rota(async (_req, res) => {
      const endereco = enderecoDaChave(res);
      if (!endereco) throw chaveSemEndereco();

      res.json({ endereco, contratos: await servico.meusContratos(endereco) });
    })
  );

  rotas.get(
    "/contratos/:contratoId(.+)/historico",
    rota(async (req, res) => {
      const contratoId = contratoIdDaUrl(req);
      const endereco = enderecoDaChave(res);
      if (!(await servico.autorizadoALer(contratoId, endereco))) throw acessoNegadoAoContrato(contratoId);

      const desdeBloco = Number(req.query.desdeBloco ?? 0);

      res.json({ contratoId, chave: contratoIdOnChain(contratoId), desdeBloco, eventos: await servico.consultarHistorico(contratoId, desdeBloco) });
    })
  );

  rotas.get(
    "/contratos/:contratoId(.+)",
    rota(async (req, res) => {
      const contratoId = contratoIdDaUrl(req);
      const endereco = enderecoDaChave(res);
      if (!(await servico.autorizadoALer(contratoId, endereco))) throw acessoNegadoAoContrato(contratoId);

      const [contrato, rede] = await Promise.all([servico.consultarContrato(contratoId), servico.nomeDaRede()]);

      res.json({ contratoId, chave: contratoIdOnChain(contratoId), rede, ...contrato });
    })
  );

  return rotas;
}
