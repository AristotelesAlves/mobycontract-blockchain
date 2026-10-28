/**
 * Catalogos de dominio. Cada valor aqui espelha um `enum` do contrato e um
 * campo enumerado em REGRAS_DE_NEGOCIO.md. `Object.entries` e usado nos testes
 * para percorrer o catalogo, entao estes objetos nao podem virar enum numerico
 * do TypeScript (enum produz entradas invertidas e quebra a contagem).
 */

export const TIPO_HASH = { Nenhum: 0, PDF: 1, ImagemDigitalizada: 2 } as const;
export type TipoHash = (typeof TIPO_HASH)[keyof typeof TIPO_HASH];

export const INDICE_REAJUSTE = { IPCA: 0, "IGP-M": 1, INPC: 2, IPET: 3 } as const;
export type IndiceReajuste = (typeof INDICE_REAJUSTE)[keyof typeof INDICE_REAJUSTE];

export const TIPO_VISTORIA = { Imovel: 0, Contrato: 1 } as const;
export type TipoVistoria = (typeof TIPO_VISTORIA)[keyof typeof TIPO_VISTORIA];

export const STATUS_CONTRATO = { NaoAssinado: 0, ParcialmenteAssinado: 1, Assinado: 2 } as const;
export type StatusContrato = (typeof STATUS_CONTRATO)[keyof typeof STATUS_CONTRATO];

export const GARANTIA = ["Caução", "Fiador", "Seguro-fiança", "Título de capitalização", "Sem garantia"] as const;
export type Garantia = (typeof GARANTIA)[number];

export const INDICE_MAXIMO_REAJUSTE = 3;