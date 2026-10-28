import { createHash } from "node:crypto";

/**
 * Hash deterministico dos campos de negocio do contrato (R-11.1.7).
 *
 * Mesmo contrato gera o mesmo hash; qualquer campo alterado muda o hash. E o
 * que permite detectar divergencia entre o que o Laravel gravou no banco e o
 * que a ledger afirma.
 */

export interface CamposCanonicos {
  versao: number;
  contratoId: string;
  imovelId: string;
  inquilinoId: string;
  dataInicio: string;
  dataFim: string | null;
  valorMensalCentavos: string;
  garantia: string;
  modeloId: string;
}

const SEP = "\u001f";

const DOMINIO_V2 = "mobycontract/v2";

const ORDEM_DOS_CAMPOS: ReadonlyArray<[string, (campos: CamposCanonicos) => string]> = [
  ["v", (c) => String(c.versao)],
  ["contrato", (c) => c.contratoId],
  ["imovel", (c) => c.imovelId],
  ["inquilino", (c) => c.inquilinoId],
  ["inicio", (c) => c.dataInicio],
  ["fim", (c) => c.dataFim ?? ""],
  ["valor", (c) => c.valorMensalCentavos],
  ["garantia", (c) => c.garantia],
  ["modelo", (c) => c.modeloId],
];

function payloadCanonico(campos: CamposCanonicos): string {
  return ORDEM_DOS_CAMPOS.map(([nome, extrair]) => `${nome}=${extrair(campos)}`).join(SEP);
}

function sha256Hex(entrada: string): string {
  return "0x" + createHash("sha256").update(entrada, "utf8").digest("hex");
}

export function deterministicHash(campos: CamposCanonicos): string {
  return sha256Hex(payloadCanonico(campos));
}

export function deterministicHashV2(campos: CamposCanonicos): string {
  return sha256Hex(`${DOMINIO_V2}${SEP}${deterministicHash(campos).slice(2)}`);
}