import { z } from "zod";
import { contratoIdOnChain } from "../../../../src/chaves";
import { DocumentoAncorado, ENTRADA_DO_DOCUMENTO } from "../documento";

/**
 * Pedido de verificacao de integridade (RF21, R-8.2).
 *
 * O unico dado que o verificador precisa e o arquivo em maos: o servico
 * calcula o SHA-256 e a chain compara com o hash ancorado. E o que permite
 * que um terceiro, sem chave e sem acesso ao MobyContract, prove que o PDF
 * apresentado e o PDF ancorado.
 */

const esquema = z.object(ENTRADA_DO_DOCUMENTO);

export class PedidoDeIntegridade {
  private constructor(
    readonly contratoId: string,
    readonly documento: DocumentoAncorado
  ) {}

  static deJson(contratoId: string, corpo: unknown): PedidoDeIntegridade {
    const entrada = esquema.parse(corpo);
    return new PedidoDeIntegridade(contratoId, DocumentoAncorado.deEntrada(entrada));
  }

  get chave(): string {
    return contratoIdOnChain(this.contratoId);
  }
}