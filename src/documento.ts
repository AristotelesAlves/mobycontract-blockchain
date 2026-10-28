import { createHash } from "node:crypto";

/**
 * SHA-256 do documento original (PDF, imagem digitalizada).
 *
 * E o hash que um terceiro confere no Apendice C da especificacao: roda
 * `sha256sum contrato.pdf` e compara com o `contratoHash` do evento. Por isso
 * o resultado e sempre prefixado com `0x` e nunca normalizado.
 */

const PREFIXO = "0x";

export function hashDocumentoBytes(bytes: Uint8Array): string {
  return PREFIXO + createHash("sha256").update(bytes).digest("hex");
}

export async function hashDocumento(caminho: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return hashDocumentoBytes(await readFile(caminho));
}