/**
 * Configuracao do registry service, lida do ambiente.
 *
 * Falha na leitura, e nao no uso: um servico que sobe sem chave privada
 * aceita requisicao e so quebra quando alguem tenta ancorar. Exigir a variavel
 * aqui troca uma falha tardia e opaca por uma falha imediata e nomeada.
 */

import { readFileSync } from "node:fs";
import type { CredenciaisAdmin } from "../dominio/credenciais";
import { gerarHashDeSenha } from "./seguranca";

export interface Configuracao {
  rpcUrl: string;
  chainIdEsperado: number;
  enderecoContrato: string;
  chavePrivada: string;
  nomeChain: string;
  web3SignerUrl: string | null;
}

export const CHAIN_ID_PADRAO = 80002;
export const RPC_PADRAO = "http://host.docker.internal:8545";
export const EXPIRACAO_TOKEN_PADRAO = 3600;
const SEGREDO_JWT_MINIMO = 32;

export interface ConfiguracaoBanco {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  max?: number;
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`variavel obrigatoria ausente: ${nome}`);
  return valor;
}

export function carregarConfiguracao(): Configuracao {
  return {
    rpcUrl: process.env.RPC_URL ?? RPC_PADRAO,
    chainIdEsperado: Number(process.env.CHAIN_ID_ESPERADO ?? String(CHAIN_ID_PADRAO)),
    enderecoContrato: obrigatoria("ENDERECO_CONTRATO"),
    chavePrivada: obrigatoria("CHAVE_PRIVADA"),
    nomeChain: process.env.NOME_CHAIN ?? "desconhecida",
    web3SignerUrl: process.env.WEB3SIGNER_URL ?? null,
  };
}

export function portaDoServico(): number {
  return Number(process.env.PORT ?? "4000");
}

export interface ConfiguracaoDeParticipantes {
  rpcUrl: string;
  chainIdEsperado: number;
  enderecoLedger: string;
  enderecoParticipantes: string;
  chaveGovernanca: string;
  rpcUrlsAdmin: string[];
  web3SignerUrl: string | null;
  web3SignerKeystoreDir: string | null;
  permissionamentoArquivo: string | null;
}

export function carregarConfiguracaoDeParticipantes(): ConfiguracaoDeParticipantes | null {
  const enderecoParticipantes = process.env.ENDERECO_PARTICIPANTES ?? procurarParticipantesNaImplantacao();
  if (!enderecoParticipantes) return null;

  return {
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    chainIdEsperado: Number(process.env.CHAIN_ID_ESPERADO ?? String(CHAIN_ID_PADRAO)),
    enderecoLedger: obrigatoria("ENDERECO_CONTRATO"),
    enderecoParticipantes,
    chaveGovernanca: obrigatoria("CHAVE_PRIVADA"),
    rpcUrlsAdmin: listaDeUrls(process.env.RPC_ADMIN_URLS),
    web3SignerUrl: process.env.WEB3SIGNER_URL ?? null,
    web3SignerKeystoreDir: process.env.WEB3SIGNER_KEYSTORE_DIR ?? null,
    permissionamentoArquivo: process.env.PERMISSIONAMENTO_ARQUIVO ?? null,
  };
}

function listaDeUrls(valor: string | undefined): string[] {
  return (valor ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function procurarParticipantesNaImplantacao(): string | null {
  const chainId = process.env.CHAIN_ID_ESPERADO ?? String(CHAIN_ID_PADRAO);
  const diretorio = process.env.DEPLOYMENTS_DIR ?? "deployments";
  try {
    const registro = JSON.parse(readFileSync(`${diretorio}/${chainId}.json`, "utf8")) as { participantes?: { address?: string } };
    return registro.participantes?.address ?? null;
  } catch {
    return null;
  }
}

export function exigirSalDePseudonimo(): string {
  return obrigatoria("PSEUDONIMO_SALT");
}

export function exigirCredenciaisAdmin(): CredenciaisAdmin {
  const usuario = process.env.ADMIN_USUARIO ?? "admin";
  const hash = process.env.ADMIN_SENHA_HASH;
  if (hash) return { usuario, senhaHash: hash };

  const senha = process.env.ADMIN_SENHA;
  if (senha) return { usuario, senhaHash: gerarHashDeSenha(senha) };

  throw new Error("variavel obrigatoria ausente: ADMIN_SENHA_HASH ou ADMIN_SENHA");
}

export function exigirSegredoJwt(): string {
  const segredo = process.env.JWT_SECRETO;
  if (!segredo || segredo.length < SEGREDO_JWT_MINIMO) {
    throw new Error(`JWT_SECRETO obrigatoria, com ao menos ${SEGREDO_JWT_MINIMO} caracteres`);
  }
  return segredo;
}

export function expiracaoDoToken(): number {
  return Number(process.env.JWT_EXPIRACAO_SEGUNDOS ?? String(EXPIRACAO_TOKEN_PADRAO));
}

export function configuracaoDoBanco(): ConfiguracaoBanco {
  return {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? "5432"),
    database: process.env.DB_NAME ?? "registry",
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    ssl: process.env.DB_SSL === "true",
    max: Number(process.env.DB_POOL_MAX ?? "10"),
  };
}