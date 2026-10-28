import { Interface } from "ethers";
import { abiDoContrato } from "./artefato";

/**
 * Traducao do revert do contrato para o vocabulario de aplicacao.
 *
 * O contrato recusa com `E_CONTRACT_EXISTS`, `E_REQUIRED_PARTY` e cia. Quem
 * consome a API (Laravel) precisa de uma familia, nao de um nome de erro
 * Solidity: e a traducao entre duas linguagens que acontece aqui e em mais
 * lugar nenhum.
 */

export type FamiliaDeRevert = "NEGOCIO" | "VALIDACAO";

const REVERTS_DE_NEGOCIO: ReadonlySet<string> = new Set([
  "E_CONTRACT_EXISTS",
  "E_ALREADY_SIGNED",
  "E_REQUIRED_PARTY",
  "E_UNKNOWN_CONTRACT",
  "E_UNKNOWN_ADITIVO",
  "E_UNKNOWN_VISTORIA",
  "E_VISTORIA_EXISTS",
  "E_INVALID_REAJUSTE",
  "E_INVALID_VISTORIA_TYPE",
]);

const REVERTS_DE_VALIDACAO: ReadonlySet<string> = new Set(["E_NO_HASH", "E_EMPTY_PARTIES", "E_EMPTY_ID", "E_UNAUTHORIZED", "E_ROLE_REVOKED"]);

let interfaceLocal: Interface | null = null;

function decodificador(): Interface {
  interfaceLocal ??= new Interface(abiDoContrato() as never);
  return interfaceLocal;
}

function payloadsDeRevert(erro: unknown): string[] {
  const brutos: unknown[] = [];

  const coletar = (valor: unknown): void => {
    if (typeof valor === "string" && /^0x[0-9a-fA-F]+$/.test(valor)) brutos.push(valor);
    else if (typeof valor === "object" && valor !== null) coletar((valor as { data?: unknown }).data);
  };

  coletar((erro as { data?: unknown }).data);
  coletar((erro as { info?: { error?: unknown } }).info?.error);
  coletar((erro as { error?: unknown }).error);

  return brutos as string[];
}

export function nomeDoRevertDoContrato(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null) return null;

  const nomeDecodificado = (erro as { revert?: { name?: unknown } }).revert?.name;
  if (typeof nomeDecodificado === "string") return nomeDecodificado;

  for (const payload of payloadsDeRevert(erro)) {
    try {
      const decodificado = decodificador().parseError(payload);
      if (decodificado) return decodificado.name;
    } catch {
      continue;
    }
  }

  const doNo = (erro as { info?: { error?: { message?: unknown } } }).info?.error?.message;
  const texto = doNo instanceof Error ? doNo.message : erro instanceof Error ? erro.message : String(erro);
  return /custom error '([A-Za-z0-9_]+)/.exec(texto)?.[1] ?? /custom error ([A-Za-z0-9_]+)/.exec(texto)?.[1] ?? null;
}

export function familiaDoRevert(erro: unknown): FamiliaDeRevert | null {
  const nome = nomeDoRevertDoContrato(erro);
  if (!nome) return null;
  if (REVERTS_DE_NEGOCIO.has(nome)) return "NEGOCIO";
  if (REVERTS_DE_VALIDACAO.has(nome)) return "VALIDACAO";
  return null;
}