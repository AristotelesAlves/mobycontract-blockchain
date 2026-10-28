/**
 * Porta de seguranca: tudo de criptografia que a aplicacao precisa, sem saber
 * que existe `node:crypto`, `jsonwebtoken` ou bcrypt atras dela.
 *
 * A implementacao concreta vive em `infra/seguranca.ts`. Trocar JWT HS256 por
 * RS256, ou scrypt por argon2, e escrever outra classe aqui.
 */

export interface ClaimsDeToken {
  sub: string;
  tipo: string;
  iat: number;
  exp: number;
}

export interface EmissaoDeToken {
  token: string;
  expiraEm: string;
}

export interface PortaDeSeguranca {
  conferirSenha(senha: string, armazenado: string): boolean;
  gerarChaveApi(): string;
  hashDeChaveApi(chave: string): string;
  assinarToken(sub: string, expiracaoSegundos: number): EmissaoDeToken;
  verificarToken(token: string): ClaimsDeToken | null;
}
