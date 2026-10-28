/**
 * Porta de saida: a fronteira onde a aplicacao fala com o armazenamento das
 * API keys gerenciadas.
 *
 * A aplicacao depende deste contrato, nao do SQLite. Trocar o banco por
 * Postgres ou por um cofre de segredos e escrever uma classe nova aqui - sem
 * tocar em caso de uso nem em rota.
 */

export interface ChaveApiRegistrada {
  id: number;
  nome: string;
  prefixo: string;
  endereco: string | null;
  criadoEm: string;
  expiraEm: string | null;
  revogadaEm: string | null;
  ultimaUtilizacaoEm: string | null;
}

export interface NovaChaveApi {
  nome: string;
  prefixo: string;
  hash: string;
  endereco: string | null;
  criadoEm: string;
  expiraEm: string | null;
}

export interface PortaDeChaves {
  criar(nova: NovaChaveApi): Promise<ChaveApiRegistrada>;
  listar(): Promise<ChaveApiRegistrada[]>;
  buscarPorHash(hash: string): Promise<ChaveApiRegistrada | null>;
  revogar(id: number, quando: string): Promise<boolean>;
  registrarUso(id: number, quando: string): Promise<void>;
}
