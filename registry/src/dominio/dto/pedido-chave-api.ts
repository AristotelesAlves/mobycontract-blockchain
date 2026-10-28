import { z } from "zod";
import { ENDERECO } from "../validacao";

/**
 * Pedido de criacao de API key.
 *
 * `expiraEm` e opcional e pode ser nulo: chave sem prazo e o padrao. Quando vem,
 * precisa ser uma data ISO 8601 completa - uma data sem fuso deixaria a
 * expiracao ambigua entre servidores.
 *
 * `endereco` vincula a chave a uma parte on-chain. E o que permite escopar a
 * leitura: uma chave com endereco so enxerga os contratos em que aquele
 * endereco figura como parte. Sem endereco, a chave le sem escopo (uso
 * administrativo).
 */

const esquema = z.object({
  nome: z.string().min(1).max(120),
  expiraEm: z.string().datetime({ offset: true }).nullable().optional(),
  endereco: ENDERECO.nullable().optional(),
});

export class PedidoDeChaveApi {
  private constructor(
    readonly nome: string,
    readonly expiraEm: string | null,
    readonly endereco: string | null
  ) {}

  static deJson(corpo: unknown): PedidoDeChaveApi {
    const entrada = esquema.parse(corpo);
    return new PedidoDeChaveApi(entrada.nome, entrada.expiraEm ?? null, entrada.endereco?.toLowerCase() ?? null);
  }
}
