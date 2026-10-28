/**
 * Superficie publica do nucleo de hashing.
 *
 * Contrato, registry service e suite de testes importam daqui. Quem precisar de
 * um item especifico pode importar do modulo proprio; este arquivo existe para
 * que uma mudanca de layout nao vire diff em tres diretorios.
 */

export { TIPO_HASH, INDICE_REAJUSTE, TIPO_VISTORIA, STATUS_CONTRATO, GARANTIA, INDICE_MAXIMO_REAJUSTE } from "./catalogo";
export type { TipoHash, IndiceReajuste, TipoVistoria, StatusContrato, Garantia } from "./catalogo";

export { contratoIdOnChain, vistoriaIdOnChain, aditivoIdOnChain, CHAVE_NULA } from "./chaves";
export { hashDocumento, hashDocumentoBytes } from "./documento";
export { hashPseudonimo, SalAusente } from "./pseudonimo";
export { deterministicHash, deterministicHashV2 } from "./determinismo";
export type { CamposCanonicos } from "./determinismo";