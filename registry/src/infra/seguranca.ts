import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { ClaimsDeToken, EmissaoDeToken, PortaDeSeguranca } from "../aplicacao/porta-seguranca";

/**
 * Primitivas criptograficas do login, sobre o modulo `node:crypto`.
 *
 * Senha com scrypt e sal por usuario; token JWT HS256 assinado com o segredo do
 * servico; API key aleatoria guardada apenas como SHA-256. Nada disso usa
 * dependencia externa de propósito: o container nao compila modulo nativo.
 */

const ALGORITMO_SENHA = "scrypt";
const TAMANHO_SAL = 16;
const TAMANHO_HASH = 64;
const PREFIXO_CHAVE = "moby_";

function agoraEmSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

export function gerarHashDeSenha(senha: string): string {
  const sal = randomBytes(TAMANHO_SAL);
  const derivada = scryptSync(senha, sal, TAMANHO_HASH);
  return `${ALGORITMO_SENHA}$${sal.toString("hex")}$${derivada.toString("hex")}`;
}

export function conferirSenha(senha: string, armazenado: string): boolean {
  const partes = armazenado.split("$");
  if (partes.length !== 3 || partes[0] !== ALGORITMO_SENHA) return false;

  const sal = Buffer.from(partes[1]!, "hex");
  const esperado = Buffer.from(partes[2]!, "hex");
  const derivada = scryptSync(senha, sal, esperado.length);

  return derivada.length === esperado.length && timingSafeEqual(derivada, esperado);
}

export function gerarChaveApi(): string {
  return PREFIXO_CHAVE + randomBytes(32).toString("hex");
}

export function hashDeChaveApi(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

function base64url(conteudo: Buffer | string): string {
  return Buffer.from(conteudo).toString("base64url");
}

export function assinarToken(sub: string, segredo: string, expiracaoSegundos: number): EmissaoDeToken {
  const emitidoEm = agoraEmSegundos();
  const expiraEm = emitidoEm + expiracaoSegundos;
  const cabecalho = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const corpo = base64url(JSON.stringify({ sub, tipo: "admin", iat: emitidoEm, exp: expiraEm }));
  const assinatura = createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");

  return { token: `${cabecalho}.${corpo}.${assinatura}`, expiraEm: new Date(expiraEm * 1000).toISOString() };
}

export function verificarToken(token: string, segredo: string): ClaimsDeToken | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  const [cabecalho, corpo, assinatura] = partes as [string, string, string];
  const esperada = createHmac("sha256", segredo).update(`${cabecalho}.${corpo}`).digest("base64url");
  const recebida = Buffer.from(assinatura);
  const calculada = Buffer.from(esperada);

  if (recebida.length !== calculada.length || !timingSafeEqual(recebida, calculada)) return null;

  try {
    const claims = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as ClaimsDeToken;
    if (typeof claims.exp !== "number" || claims.exp < agoraEmSegundos()) return null;
    return claims;
  } catch {
    return null;
  }
}

export class SegurancaNode implements PortaDeSeguranca {
  constructor(private readonly segredo: string) {}

  conferirSenha(senha: string, armazenado: string): boolean {
    return conferirSenha(senha, armazenado);
  }

  gerarChaveApi(): string {
    return gerarChaveApi();
  }

  hashDeChaveApi(chave: string): string {
    return hashDeChaveApi(chave);
  }

  assinarToken(sub: string, expiracaoSegundos: number): EmissaoDeToken {
    return assinarToken(sub, this.segredo, expiracaoSegundos);
  }

  verificarToken(token: string): ClaimsDeToken | null {
    return verificarToken(token, this.segredo);
  }
}
