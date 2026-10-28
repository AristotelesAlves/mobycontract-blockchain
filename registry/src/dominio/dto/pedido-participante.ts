import { z } from "zod";
import { ErroAplicacao } from "../erro";
import { ENDERECO } from "../validacao";

/**
 * Pedidos de administracao de participante do consorcio.
 *
 * `PedidoDeParticipante` cobre a admissao: o membro e identificado por `nome`
 * (usado no arquivo de chave do Web3Signer) e a escrita on-chain sai com o
 * `papel` escolhido. O destino pode vir de tres formas, em ordem de prioridade:
 *
 *   - `chavePrivada`: o servico deriva o endereco (e, com keystore configurado,
 *     persiste a chave para o Web3Signer assinar);
 *   - `endereco`: a chave e gerenciada por fora;
 *   - nenhum dos dois: so e valido se o keystore estiver configurado, caso em
 *     que o servico gera a chave.
 *
 * `PedidoDeRemocao` aceita tanto o nome quanto o endereco `0x` como
 * identificador: o nome resolve pelo arquivo de chave, o endereco e direto.
 */

const NOME = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/, "nome deve conter apenas letras, numeros, '-' ou '_'");
const CHAVE_PRIVADA = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "chave privada deve ter 32 bytes em hexadecimal");

const PAPEIS = { Registrador: 2, Parte: 3 } as const;
export type NomeDePapel = keyof typeof PAPEIS;

const esquema = z
  .object({
    nome: NOME,
    papel: z.enum(["Registrador", "Parte"]).default("Registrador"),
    endereco: ENDERECO.optional(),
    chavePrivada: CHAVE_PRIVADA.optional(),
  })
  .refine((valor) => !(valor.endereco && valor.chavePrivada), {
    message: "informe endereco ou chavePrivada, nao ambos",
    path: ["endereco"],
  });

export class PedidoDeParticipante {
  private constructor(
    readonly nome: string,
    readonly papel: NomeDePapel,
    readonly endereco: string | null,
    readonly chavePrivada: string | null
  ) {}

  get numeroDoPapel(): number {
    return PAPEIS[this.papel];
  }

  get ancora(): boolean {
    return this.papel !== "Parte";
  }

  static deJson(corpo: unknown): PedidoDeParticipante {
    const entrada = esquema.parse(corpo);
    return new PedidoDeParticipante(
      entrada.nome,
      entrada.papel,
      entrada.endereco?.toLowerCase() ?? null,
      entrada.chavePrivada?.toLowerCase() ?? null
    );
  }
}

export class PedidoDeRemocao {
  private constructor(
    readonly nome: string | null,
    readonly endereco: string | null
  ) {}

  static deIdentificador(valor: string): PedidoDeRemocao {
    const limpo = valor.trim();

    if (ENDERECO.safeParse(limpo).success) return new PedidoDeRemocao(null, limpo.toLowerCase());
    if (NOME.safeParse(limpo).success) return new PedidoDeRemocao(limpo, null);

    throw new ErroAplicacao("VALIDACAO", "IDENTIFICADOR_INVALIDO", "identificador deve ser um endereco 0x ou um nome de participante", {
      identificador: valor,
    });
  }
}
