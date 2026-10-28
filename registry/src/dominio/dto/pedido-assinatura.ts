import { z } from "zod";
import { contratoIdOnChain } from "../../../../src/chaves";
import { ENDERECO, IDENTIFICADOR } from "../validacao";

/**
 * Pedido de assinatura de uma das partes do contrato.
 *
 * A chain registra *que* a parte aprovou e em que bloco. A assinatura
 * criptografica em si e verificada pelo provedor de identidade antes de a API
 * receber o pedido - ver limitacao conhecida 17.2 da especificacao.
 */

const esquema = z.object({
  contratoId: IDENTIFICADOR,
  parte: ENDERECO,
});

export class PedidoDeAssinatura {
  private constructor(
    readonly contratoId: string,
    readonly parte: string
  ) {}

  static deJson(corpo: unknown): PedidoDeAssinatura {
    const entrada = esquema.parse(corpo);
    return new PedidoDeAssinatura(entrada.contratoId, entrada.parte);
  }

  get chave(): string {
    return contratoIdOnChain(this.contratoId);
  }
}