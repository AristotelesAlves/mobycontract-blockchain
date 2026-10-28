import type { ComandoDeAditivo, ComandoDeContrato, ComandoDeVistoria } from "../dominio/comando";
import type { Ancora, ConsultaDeContrato, EventoDeHistorico, ResultadoDeIntegridade, SaudeLedger, TransacaoDeContrato, VerificacaoDeRede } from "../dominio/resultado";

/**
 * Porta de saida: a fronteira onde a aplicacao fala com a ledger.
 *
 * A aplicacao depende deste contrato, nao do ethers. Trocar Polygon por outra
 * rede EVM, ou trocar ethers por viem, e escrever uma classe nova aqui - sem
 * tocar em regra de negocio nem em rota.
 */

export interface EscritaEmNome {
  assinante?: string | null;
}

export interface PortaLedger {
  registrarContrato(comando: ComandoDeContrato, emNome?: EscritaEmNome): Promise<Ancora>;
  registrarAssinatura(chave: string, parte: string, emNome?: EscritaEmNome): Promise<Ancora>;
  registrarAditivo(comando: ComandoDeAditivo, emNome?: EscritaEmNome): Promise<Ancora>;
  registrarVistoria(comando: ComandoDeVistoria, emNome?: EscritaEmNome): Promise<Ancora>;

  existeContrato(chave: string): Promise<boolean>;
  consultarContrato(chave: string): Promise<ConsultaDeContrato>;
  consultarPartes(chave: string): Promise<string[]>;
  contratosDaParte(endereco: string): Promise<string[]>;
  consultarAssinaturas(chave: string, partes: string[]): Promise<Record<string, boolean>>;
  consultarHistorico(chave: string, desdeBloco: number): Promise<EventoDeHistorico[]>;
  verificarIntegridade(chave: string, documentoHash: string): Promise<ResultadoDeIntegridade>;
  consultarTransacao(hashTransacao: string): Promise<TransacaoDeContrato | null>;

  verificarRede(): Promise<VerificacaoDeRede>;
  saude(): Promise<SaudeLedger>;
}
