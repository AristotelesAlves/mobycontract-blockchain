/**
 * Credenciais do administrador que emite e revoga as API keys.
 *
 * Sao um unico par (usuario, hash de senha) vindo do ambiente. O hash nunca
 * fica em texto plano: ou o operador fornece `ADMIN_SENHA_HASH`, ou o servico
 * deriva um na subida a partir de `ADMIN_SENHA`.
 */

export interface CredenciaisAdmin {
  usuario: string;
  senhaHash: string;
}
