/**
 * Resultados de leitura e escrita do ledger, ja normalizados.
 *
 * A porta devolve isto e nao o struct cru do ethers: quem consome a camada de
 * aplicacao nao deve conhecer `Result`, `bigint` nem nome de campo em snake
 * case vindo do ABI.
 */

export interface Ancora {
  chave: string;
  hashTransacao: string;
  numeroBloco: number;
  carimboTempo: number;
  confirmacoes: number;
}

export interface ResultadoDeIntegridade {
  integro: boolean;
  hashAncorado: string;
}

export interface TransacaoDeContrato {
  hashTransacao: string;
  numeroBloco: number;
  confirmacoes: number;
  chave: string;
  hashDocumento: string;
}

export interface ParticipanteAdministrado {
  endereco: string;
  papel: number;
  papelNome: string;
  acoes: string[];
  transacoes: Record<string, string | null>;
}

export interface EventoDeHistorico {
  evento: string;
  chave: string;
  bloco: number;
  hashTransacao: string;
  logIndex: number;
  argumentos: Record<string, string | number | boolean | string[]>;
}

export interface ConsultaDeContrato {
  status: number;
  registroPor: string;
  registradoEm: number;
  bloco: number;
  hashDocumento: string;
  deterministicHash: string;
  deterministicHashV2: string;
  prazoVigenciaDias: number;
  indiceReajuste: number;
  tipoHash: number;
  partes: string[];
}

export interface ContratoAncorado extends ConsultaDeContrato {
  assinaturas: Record<string, boolean>;
}

export interface SaudeLedger {
  status: "ok" | "rede_incorreta";
  nomeChain: string;
  chainId: number;
  chainIdEsperado: number;
  enderecoContrato: string;
  alturaBloco: number;
  timestamp: string;
}

export interface VerificacaoDeRede {
  chainId: number;
  nome: string;
  confere: boolean;
}
