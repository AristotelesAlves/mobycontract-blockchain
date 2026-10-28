import { createHash } from "node:crypto";

/**
 * Pseudonimizacao de dado pessoal (RNF04).
 *
 * `sha256(sal + ":" + valor)`: o sal impede reversao por tabela, e a funcao
 * lanca em vez de devolver um hash sem protecao quando o sal nao esta no
 * ambiente. Um pseudonimo sem sal seria pior que o dado em claro, porque
 * pareceria protegido.
 */

export class SalAusente extends Error {
  constructor() {
    super("PSEUDONIMO_SALT ausente: um pseudonimo sem sal nao protege dado pessoal (RNF04).");
    this.name = "SalAusente";
  }
}

export function hashPseudonimo(valor: string, sal: string | undefined = process.env.PSEUDONIMO_SALT): string {
  if (!sal) throw new SalAusente();
  return "0x" + createHash("sha256").update(`${sal}:${valor}`, "utf8").digest("hex");
}