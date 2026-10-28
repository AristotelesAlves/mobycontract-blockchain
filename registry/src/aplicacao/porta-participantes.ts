/**
 * Porta de saida: administracao de participantes do consorcio.
 *
 * A aplicacao orquestra a admissao/remocao (quais passos, em que ordem), mas nao
 * conhece ethers, Besu nem Web3Signer. Cada operacao primitiva mora aqui; a
 * implementacao de producao fala com os nos Besu (API PERM), com os contratos
 * `RegistroDeParticipantes`/`MobyContractRegistry` e com o keystore do
 * Web3Signer.
 *
 * Nem todo ambiente tem todas as capacidades: a allowlist de contas e especifica
 * do Besu e o keystore depende de um volume montado. `capacidade()` deixa a
 * aplicacao decidir o que pular, sem tentar operacoes que o ambiente nao
 * suporta.
 */

export interface CapacidadeDeParticipantes {
  permissao: boolean;
  chaves: boolean;
}

export interface PortaParticipantes {
  capacidade(): CapacidadeDeParticipantes;

  derivarEndereco(chavePrivada: string): string;
  publicarChave(nome: string, chavePrivada: string): Promise<string>;
  gerarChave(nome: string): Promise<string>;
  enderecoDaChave(nome: string): Promise<string | null>;
  removerChave(nome: string): Promise<void>;

  adicionarNaAllowlist(endereco: string): Promise<void>;
  removerDaAllowlist(endereco: string): Promise<void>;

  habilitarNoConsorcio(endereco: string, papel: number): Promise<string>;
  encerrarNoConsorcio(endereco: string): Promise<string>;
  concederRegistrador(endereco: string): Promise<string>;
  revogarRegistrador(endereco: string): Promise<string>;

  recarregarAssinador(): Promise<void>;
}
