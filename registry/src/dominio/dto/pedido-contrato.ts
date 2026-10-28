import { z } from "zod";
import { contratoIdOnChain } from "../../../../src/chaves";
import type { CamposCanonicos } from "../../../../src/determinismo";
import { GARANTIA, INDICE_MAXIMO_REAJUSTE, TIPO_HASH, type IndiceReajuste, type TipoHash } from "../../../../src/catalogo";
import { DocumentoAncorado, ENTRADA_DO_DOCUMENTO } from "../documento";
import { CENTAVOS, DATA, ENDERECO, IDENTIFICADOR } from "../validacao";

/**
 * Pedido de ancoragem de contrato de locacao.
 *
 * DTO com construtor privado e fabricas: quem instancia o pedido ja recebe um
 * objeto validado, e a rota HTTP nao precisa saber a ordem dos campos.
 */

const esquema = z.object({
  versaoEsquema: z.number().int().min(1).default(1),
  contratoId: IDENTIFICADOR,
  imovelId: IDENTIFICADOR,
  inquilinoId: IDENTIFICADOR,
  dataInicio: DATA,
  dataFim: DATA.nullable(),
  valorMensalCentavos: CENTAVOS,
  garantia: z.enum(GARANTIA),
  modeloId: IDENTIFICADOR,
  partes: z.array(ENDERECO).min(1, "contrato exige ao menos uma parte"),
  tipoHash: z.number().int().min(0).max(2).default(TIPO_HASH.PDF),
  prazoVigenciaDias: z.number().int().min(0).max(36500).default(365),
  indiceReajuste: z.number().int().min(0).max(INDICE_MAXIMO_REAJUSTE).default(0),
  ...ENTRADA_DO_DOCUMENTO,
});

export class PedidoDeContrato {
  private constructor(
    readonly campos: CamposCanonicos,
    readonly partes: string[],
    readonly documento: DocumentoAncorado,
    readonly tipoHash: TipoHash,
    readonly prazoVigenciaDias: number,
    readonly indiceReajuste: IndiceReajuste
  ) {}

  static deJson(corpo: unknown): PedidoDeContrato {
    const entrada = esquema.parse(corpo);

    return new PedidoDeContrato(
      {
        versao: entrada.versaoEsquema,
        contratoId: entrada.contratoId,
        imovelId: entrada.imovelId,
        inquilinoId: entrada.inquilinoId,
        dataInicio: entrada.dataInicio,
        dataFim: entrada.dataFim,
        valorMensalCentavos: entrada.valorMensalCentavos,
        garantia: entrada.garantia,
        modeloId: entrada.modeloId,
      },
      entrada.partes,
      DocumentoAncorado.deEntrada(entrada),
      entrada.tipoHash as TipoHash,
      entrada.prazoVigenciaDias,
      entrada.indiceReajuste as IndiceReajuste
    );
  }

  get chave(): string {
    return contratoIdOnChain(this.campos.contratoId);
  }
}