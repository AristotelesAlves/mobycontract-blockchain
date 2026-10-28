import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Derivacao da chave on-chain a partir do identificador de negocio.
 *
 * Espelha `contracts/lib/DerivacaoDeChave.sol` palavra por palavra: se uma das
 * duas implementacoes mudar, a ancora criada pelo servico deixa de ser
 * recuperavel pelo contrato e vice-versa.
 */

const SEPARADOR = Buffer.from([0x1f]);

export function contratoIdOnChain(contratoId: string): string {
  return keccak256(toUtf8Bytes(contratoId));
}

export function vistoriaIdOnChain(vistoriaId: string): string {
  return keccak256(toUtf8Bytes(vistoriaId));
}

export function aditivoIdOnChain(chaveContrato: string, aditivoId: string): string {
  const payload = Buffer.concat([Buffer.from(chaveContrato.slice(2), "hex"), SEPARADOR, Buffer.from(aditivoId, "utf8")]);
  return keccak256(payload);
}

export const CHAVE_NULA = "0x" + "0".repeat(64);