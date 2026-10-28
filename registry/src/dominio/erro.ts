/**
 * Erro de aplicacao: a unica coisa que a camada HTTP precisa saber.
 *
 * A familia decide o status; o codigo decide a mensagem que o Laravel traduz.
 * O detalhe vai no corpo da resposta, entao nunca pode conter stack trace ou
 * valor de entrada que o chamador nao enviou.
 */

export type FamiliaDeErro = "AUTENTICACAO" | "AUTORIZACAO" | "VALIDACAO" | "NEGOCIO" | "REDE" | "INTERNO";

export const STATUS_POR_FAMILIA: Readonly<Record<FamiliaDeErro, number>> = {
  AUTENTICACAO: 401,
  AUTORIZACAO: 403,
  VALIDACAO: 422,
  NEGOCIO: 409,
  REDE: 502,
  INTERNO: 500,
};

export class ErroAplicacao extends Error {
  constructor(
    readonly familia: FamiliaDeErro,
    readonly codigo: string,
    mensagem: string,
    readonly detalhe: Record<string, unknown> = {}
  ) {
    super(mensagem);
    this.name = "ErroAplicacao";
  }

  get status(): number {
    return STATUS_POR_FAMILIA[this.familia];
  }

  toJSON(): { erro: { familia: FamiliaDeErro; codigo: string; mensagem: string; detalhe: Record<string, unknown> } } {
    return { erro: { familia: this.familia, codigo: this.codigo, mensagem: this.message, detalhe: this.detalhe } };
  }
}

export function contratoNaoAncorado(contratoId: string): ErroAplicacao {
  return new ErroAplicacao("NEGOCIO", "CONTRATO_NAO_ANCORADO", "o contrato precisa estar ancorado antes de receber assinatura ou derivado", { contratoId });
}

export function credenciaisInvalidas(): ErroAplicacao {
  return new ErroAplicacao("AUTENTICACAO", "CREDENCIAIS_INVALIDAS", "usuario ou senha invalidos");
}

export function chaveApiNaoEncontrada(id: number): ErroAplicacao {
  return new ErroAplicacao("NEGOCIO", "CHAVE_NAO_ENCONTRADA", "nao existe API key com esse identificador", { id });
}

export function chaveSemEndereco(): ErroAplicacao {
  return new ErroAplicacao("AUTORIZACAO", "CHAVE_SEM_ENDERECO", "a API key nao esta vinculada a um endereco de parte");
}

export function acessoNegadoAoContrato(contratoId: string): ErroAplicacao {
  return new ErroAplicacao("AUTORIZACAO", "ACESSO_NEGADO", "a parte autenticada nao participa deste contrato", { contratoId });
}