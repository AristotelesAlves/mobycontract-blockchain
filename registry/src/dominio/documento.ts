import { z } from "zod";
import { hashDocumentoBytes } from "../../../src/documento";
import { ErroAplicacao } from "./erro";
import { HASH } from "./validacao";

/**
 * Documento a ancorar: hash informado pelo chamador ou bytes do arquivo.
 *
 * Value object porque o hash e a identidade do documento. A resolucao fica
 * aqui, e nao em cada rota, para que "documentoBase64 ou documentoHash" seja
 * uma regra unica e a mensagem de erro seja sempre a mesma.
 */

export const ENTRADA_DO_DOCUMENTO = {
  documentoBase64: z.string().min(1).optional(),
  documentoHash: HASH.optional(),
};

export class DocumentoAncorado {
  private constructor(readonly hash: string) {}

  static deHash(hash: string): DocumentoAncorado {
    return new DocumentoAncorado(hash);
  }

  static deBase64(documentoBase64: string): DocumentoAncorado {
    return new DocumentoAncorado(hashDocumentoBytes(Buffer.from(documentoBase64, "base64")));
  }

  static deEntrada(entrada: { documentoBase64?: string; documentoHash?: string }): DocumentoAncorado {
    if (entrada.documentoHash) return DocumentoAncorado.deHash(entrada.documentoHash);
    if (entrada.documentoBase64) return DocumentoAncorado.deBase64(entrada.documentoBase64);
    throw new ErroAplicacao("VALIDACAO", "DOCUMENTO_AUSENTE", "informe documentoBase64 ou documentoHash");
  }
}