import { z } from "zod";
import { CHAVE_NULA, contratoIdOnChain, vistoriaIdOnChain } from "../../../../src/chaves";
import { TIPO_VISTORIA, type TipoVistoria } from "../../../../src/catalogo";
import { DocumentoAncorado, ENTRADA_DO_DOCUMENTO } from "../documento";
import { IDENTIFICADOR } from "../validacao";

/**
 * Pedido de ancoragem de vistoria.
 *
 * `tipoRelacao` distingue vistoria de imovel (antes de qualquer contrato) de
 * vistoria de contrato. Uma vistoria de imovel com contrato informado e
 * recusada pelo contrato: seria um contrato orfao (R-9.1.8).
 */

const esquema = z.object({
  vistoriaId: IDENTIFICADOR,
  contratoId: IDENTIFICADOR.nullable(),
  imovelId: IDENTIFICADOR,
  tipoRelacao: z.union([z.literal(TIPO_VISTORIA.Imovel), z.literal(TIPO_VISTORIA.Contrato)]),
  ...ENTRADA_DO_DOCUMENTO,
});

export class PedidoDeVistoria {
  private constructor(
    readonly vistoriaId: string,
    readonly contratoId: string | null,
    readonly imovelId: string,
    readonly tipoRelacao: TipoVistoria,
    readonly documento: DocumentoAncorado
  ) {}

  static deJson(corpo: unknown): PedidoDeVistoria {
    const entrada = esquema.parse(corpo);
    return new PedidoDeVistoria(entrada.vistoriaId, entrada.contratoId, entrada.imovelId, entrada.tipoRelacao, DocumentoAncorado.deEntrada(entrada));
  }

  get chaveContrato(): string {
    return this.contratoId === null ? CHAVE_NULA : contratoIdOnChain(this.contratoId);
  }

  get chave(): string {
    return vistoriaIdOnChain(this.vistoriaId);
  }
}