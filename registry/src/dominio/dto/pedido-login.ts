import { z } from "zod";

/**
 * Pedido de login do administrador.
 *
 * Mesmo com um unico usuario, o DTO valida tamanho e presenca: a mensagem de
 * erro tem que ser a mesma para "usuario inexistente" e "senha errada", entao a
 * validacao de forma fica separada da conferencia de credencial.
 */

const esquema = z.object({
  usuario: z.string().min(1).max(128),
  senha: z.string().min(1).max(256),
});

export class PedidoDeLogin {
  private constructor(
    readonly usuario: string,
    readonly senha: string
  ) {}

  static deJson(corpo: unknown): PedidoDeLogin {
    const entrada = esquema.parse(corpo);
    return new PedidoDeLogin(entrada.usuario, entrada.senha);
  }
}
