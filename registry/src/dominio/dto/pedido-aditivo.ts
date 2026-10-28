import { z } from "zod";
import { aditivoIdOnChain, contratoIdOnChain } from "../../../../src/chaves";
import { DocumentoAncorado, ENTRADA_DO_DOCUMENTO } from "../documento";
import { IDENTIFICADOR } from "../validacao";

/**
 * Pedido de ancoragem de aditivo.
 *
 * O aditivo nunca existe sozinho: a chave e derivada do contrato pai mais o
 * identificador do aditivo, o que torna a reancoragem do mesmo aditivo no
 * mesmo contrato um reverte do contrato (R-11.2.2).
 */

const esquema = z.object({
  contratoId: IDENTIFICADOR,
  aditivoId: IDENTIFICADOR,
  tipoObjeto: IDENTIFICADOR,
  ...ENTRADA_DO_DOCUMENTO,
});

export class PedidoDeAditivo {
  private constructor(
    readonly contratoId: string,
    readonly aditivoId: string,
    readonly tipoObjeto: string,
    readonly documento: DocumentoAncorado
  ) {}

  static deJson(corpo: unknown): PedidoDeAditivo {
    const entrada = esquema.parse(corpo);
    return new PedidoDeAditivo(entrada.contratoId, entrada.aditivoId, entrada.tipoObjeto, DocumentoAncorado.deEntrada(entrada));
  }

  get chaveContrato(): string {
    return contratoIdOnChain(this.contratoId);
  }

  get chave(): string {
    return aditivoIdOnChain(this.chaveContrato, this.aditivoId);
  }
}