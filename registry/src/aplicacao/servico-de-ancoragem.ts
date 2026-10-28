import { deterministicHash, deterministicHashV2 } from "../../../src/determinismo";
import { hashPseudonimo } from "../../../src/pseudonimo";
import { contratoIdOnChain } from "../../../src/chaves";
import type { ComandoDeAditivo, ComandoDeContrato, ComandoDeVistoria } from "../dominio/comando";
import type { PedidoDeAditivo } from "../dominio/dto/pedido-aditivo";
import type { PedidoDeAssinatura } from "../dominio/dto/pedido-assinatura";
import type { PedidoDeContrato } from "../dominio/dto/pedido-contrato";
import type { PedidoDeIntegridade } from "../dominio/dto/pedido-integridade";
import type { PedidoDeVistoria } from "../dominio/dto/pedido-vistoria";
import { contratoNaoAncorado } from "../dominio/erro";
import type { Ancora, ContratoAncorado, EventoDeHistorico, ResultadoDeIntegridade, SaudeLedger, TransacaoDeContrato } from "../dominio/resultado";
import type { PortaLedger } from "./porta-ledger";

/**
 * Servico de ancoragem: os casos de uso do registry service.
 *
 * Concentra o trabalho de dominio que antes estava espalhado dentro dos
 * handlers HTTP - derivar chave, calcular hash deterministico, pseudonimizar o
 * inquilino, exigir contrato pai antes do derivado. A rota passa a fazer tres
 * coisas: validar a entrada, chamar um metodo daqui, serializar a resposta.
 */

export interface AncoraComDocumento extends Ancora {
  hashDocumento: string;
}

export class ServicoDeAncoragem {
  constructor(private readonly ledger: PortaLedger) {}

  async ancorarContrato(pedido: PedidoDeContrato, assinante?: string | null): Promise<AncoraComDocumento> {
    const ancora = await this.ledger.registrarContrato(comandoDeContrato(pedido), { assinante });
    return { ...ancora, chave: ancora.chave || pedido.chave, hashDocumento: pedido.documento.hash };
  }

  async registrarAssinatura(pedido: PedidoDeAssinatura, assinante?: string | null): Promise<Ancora> {
    await this.exigirContratoAncorado(pedido.chave, pedido.contratoId);
    const ancora = await this.ledger.registrarAssinatura(pedido.chave, pedido.parte, { assinante });
    return { ...ancora, chave: pedido.chave };
  }

  async ancorarAditivo(pedido: PedidoDeAditivo, assinante?: string | null): Promise<AncoraComDocumento> {
    await this.exigirContratoAncorado(pedido.chaveContrato, pedido.contratoId);

    const ancora = await this.ledger.registrarAditivo(comandoDeAditivo(pedido), { assinante });
    return { ...ancora, chave: ancora.chave || pedido.chave, hashDocumento: pedido.documento.hash };
  }

  async ancorarVistoria(pedido: PedidoDeVistoria, assinante?: string | null): Promise<AncoraComDocumento> {
    const ancora = await this.ledger.registrarVistoria(comandoDeVistoria(pedido), { assinante });
    return { ...ancora, chave: ancora.chave || pedido.chave, hashDocumento: pedido.documento.hash };
  }

  async consultarContrato(contratoId: string): Promise<ContratoAncorado> {
    const chave = contratoIdOnChain(contratoId);
    if (!(await this.ledger.existeContrato(chave))) throw contratoNaoAncorado(contratoId);

    const consulta = await this.ledger.consultarContrato(chave);
    const assinaturas = await this.ledger.consultarAssinaturas(chave, consulta.partes);

    return { ...consulta, assinaturas };
  }

  async meusContratos(endereco: string): Promise<string[]> {
    return this.ledger.contratosDaParte(endereco);
  }

  async autorizadoALer(contratoId: string, endereco: string | null): Promise<boolean> {
    if (!endereco) return true;

    const chave = contratoIdOnChain(contratoId);
    if (!(await this.ledger.existeContrato(chave))) throw contratoNaoAncorado(contratoId);

    const partes = await this.ledger.consultarPartes(chave);
    const alvo = endereco.toLowerCase();
    return partes.some((parte) => parte.toLowerCase() === alvo);
  }

  async verificarIntegridade(pedido: PedidoDeIntegridade): Promise<ResultadoDeIntegridade> {
    return this.ledger.verificarIntegridade(pedido.chave, pedido.documento.hash);
  }

  async consultarTransacao(hashTransacao: string): Promise<TransacaoDeContrato | null> {
    return this.ledger.consultarTransacao(hashTransacao);
  }

  async consultarHistorico(contratoId: string, desdeBloco: number): Promise<EventoDeHistorico[]> {
    return this.ledger.consultarHistorico(contratoIdOnChain(contratoId), desdeBloco);
  }

  async nomeDaRede(): Promise<string> {
    return (await this.ledger.verificarRede()).nome;
  }

  async saude(): Promise<SaudeLedger> {
    return this.ledger.saude();
  }

  private async exigirContratoAncorado(chave: string, contratoId: string): Promise<void> {
    if (!(await this.ledger.existeContrato(chave))) throw contratoNaoAncorado(contratoId);
  }
}

function comandoDeContrato(pedido: PedidoDeContrato): ComandoDeContrato {
  const { campos } = pedido;

  return {
    contratoId: campos.contratoId,
    deterministicHash: deterministicHash(campos),
    deterministicHashV2: deterministicHashV2(campos),
    contratoHash: pedido.documento.hash,
    locatarioHash: hashPseudonimo(campos.inquilinoId),
    imovelHash: hashPseudonimo(campos.imovelId),
    documentoModeloHash: hashPseudonimo(campos.modeloId),
    tipoHash: pedido.tipoHash,
    prazoVigenciaDias: pedido.prazoVigenciaDias,
    indiceReajuste: pedido.indiceReajuste,
    partes: pedido.partes,
  };
}

function comandoDeAditivo(pedido: PedidoDeAditivo): ComandoDeAditivo {
  return {
    aditivoId: pedido.aditivoId,
    contratoId: pedido.chaveContrato,
    aditivoHash: pedido.documento.hash,
    tipoObjetoHash: hashPseudonimo(pedido.tipoObjeto),
  };
}

function comandoDeVistoria(pedido: PedidoDeVistoria): ComandoDeVistoria {
  return {
    vistoriaId: pedido.vistoriaId,
    contratoId: pedido.chaveContrato,
    imovelHash: hashPseudonimo(pedido.imovelId),
    vistoriaHash: pedido.documento.hash,
    tipoRelacao: pedido.tipoRelacao,
  };
}
