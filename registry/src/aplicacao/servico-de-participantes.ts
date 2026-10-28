import { ErroAplicacao } from "../dominio/erro";
import type { PedidoDeParticipante, PedidoDeRemocao } from "../dominio/dto/pedido-participante";
import type { ParticipanteAdministrado } from "../dominio/resultado";
import type { PortaParticipantes } from "./porta-participantes";

/**
 * Caso de uso: admitir e remover participantes dinamicos do consorcio.
 *
 * A regra de negocio e a ordem das operacoes. Para admitir um membro que possa
 * ancorar, o contrato `MobyContractRegistry` exige **duas** condicoes ao mesmo
 * tempo - o papel no `RegistroDeParticipantes` (`podeAncorar`) e a entrada na
 * tabela `registradores` (`concederRegistrador`). Por isso a admissao de um
 * `Registrador` faz os dois; a de uma `Parte` so o primeiro (parte nao ancora).
 *
 * A allowlist Besu e o keystore do Web3Signer sao opcionais: cada etapa so roda
 * se a porta declarar a capacidade. A resposta `acoes` registra o que ocorreu.
 */
export class ServicoDeParticipantes {
  constructor(private readonly porta: PortaParticipantes) {}

  async adicionar(pedido: PedidoDeParticipante): Promise<ParticipanteAdministrado> {
    const capacidade = this.porta.capacidade();
    const acoes: string[] = [];

    let endereco: string;
    let chavePublicada = false;

    if (pedido.chavePrivada) {
      endereco = this.porta.derivarEndereco(pedido.chavePrivada);
    } else if (pedido.endereco) {
      endereco = pedido.endereco;
    } else if (capacidade.chaves) {
      endereco = await this.porta.gerarChave(pedido.nome);
      chavePublicada = true;
      acoes.push("chave-gerada");
    } else {
      throw new ErroAplicacao(
        "VALIDACAO",
        "DESTINO_AUSENTE",
        "informe endereco ou chavePrivada; ou configure o keystore do Web3Signer para gerar a chave"
      );
    }

    if (pedido.chavePrivada && capacidade.chaves) {
      await this.porta.publicarChave(pedido.nome, pedido.chavePrivada);
      chavePublicada = true;
      acoes.push("chave-publicada");
    }

    if (capacidade.permissao) {
      await this.porta.adicionarNaAllowlist(endereco);
      acoes.push("allowlist");
    }

    const transacaoConsorcio = await this.porta.habilitarNoConsorcio(endereco, pedido.numeroDoPapel);
    acoes.push("consorcio");

    let transacaoRegistrador: string | null = null;
    if (pedido.ancora) {
      transacaoRegistrador = await this.porta.concederRegistrador(endereco);
      acoes.push("registrador");
    }

    if (chavePublicada) {
      await this.porta.recarregarAssinador();
      acoes.push("assinador-recarregado");
    }

    return {
      endereco,
      papel: pedido.numeroDoPapel,
      papelNome: pedido.papel,
      acoes,
      transacoes: { consorcio: transacaoConsorcio, registrador: transacaoRegistrador },
    };
  }

  async remover(pedido: PedidoDeRemocao): Promise<ParticipanteAdministrado> {
    const capacidade = this.porta.capacidade();
    const acoes: string[] = [];

    const endereco = await this.resolverEndereco(pedido, capacidade.chaves);
    if (!endereco) {
      throw new ErroAplicacao("NEGOCIO", "PARTICIPANTE_NAO_ENCONTRADO", "nao foi possivel resolver o endereco do participante", {
        identificador: pedido.endereco ?? pedido.nome,
      });
    }

    if (capacidade.permissao) {
      await this.porta.removerDaAllowlist(endereco);
      acoes.push("allowlist");
    }

    const transacaoConsorcio = await this.porta.encerrarNoConsorcio(endereco);
    acoes.push("consorcio-encerrado");

    const transacaoRegistrador = await this.porta.revogarRegistrador(endereco);
    acoes.push("registrador-revogado");

    if (pedido.nome && capacidade.chaves) {
      await this.porta.removerChave(pedido.nome);
      acoes.push("chave-removida");
      await this.porta.recarregarAssinador();
      acoes.push("assinador-recarregado");
    }

    return {
      endereco,
      papel: 0,
      papelNome: "Nenhum",
      acoes,
      transacoes: { consorcio: transacaoConsorcio, registrador: transacaoRegistrador },
    };
  }

  private async resolverEndereco(pedido: PedidoDeRemocao, temKeystore: boolean): Promise<string | null> {
    if (pedido.endereco) return pedido.endereco;
    if (!pedido.nome || !temKeystore) return null;
    return this.porta.enderecoDaChave(pedido.nome);
  }
}
