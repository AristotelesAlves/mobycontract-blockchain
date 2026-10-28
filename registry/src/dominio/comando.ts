import type { IndiceReajuste, TipoHash } from "../../../src/catalogo";

/**
 * Comandos de escrita ja com os hashes resolvidos.
 *
 * Sao a fronteira entre a regra de negocio (quem calcula o pseudonimo e o hash
 * deterministico) e a ledger (apenas persiste bytes). Nao aceitam `documentoBase64`
 * nem identificador de negocio: a chain so conhece hash.
 */

export interface ComandoDeContrato {
  contratoId: string;
  deterministicHash: string;
  deterministicHashV2: string;
  contratoHash: string;
  locatarioHash: string;
  imovelHash: string;
  documentoModeloHash: string;
  tipoHash: TipoHash;
  prazoVigenciaDias: number;
  indiceReajuste: IndiceReajuste;
  partes: string[];
}

export interface ComandoDeAditivo {
  aditivoId: string;
  contratoId: string;
  aditivoHash: string;
  tipoObjetoHash: string;
}

export interface ComandoDeVistoria {
  vistoriaId: string;
  contratoId: string;
  imovelHash: string;
  vistoriaHash: string;
  tipoRelacao: number;
}