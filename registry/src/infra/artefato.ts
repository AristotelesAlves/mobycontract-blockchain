import { readFileSync } from "node:fs";
import type { InterfaceAbi } from "ethers";

/**
 * Artefato compilado do contrato (ABI + bytecode).
 *
 * Lido uma vez por processo: em runtime o arquivo vem da imagem Docker, e no
 * desenvolvimento pode ser recompilado entre chamadas, entao o cache e
 * invalidado em teste e nao em producao.
 */

export interface ArtefatoDoContrato {
  abi: InterfaceAbi;
  bytecode: string;
}

const CAMINHO_PADRAO = "artifacts/contracts/MobyContractRegistry.sol/MobyContractRegistry.json";
const CAMINHO_PARTICIPANTES = "artifacts/contracts/RegistroDeParticipantes.sol/RegistroDeParticipantes.json";

let cache: ArtefatoDoContrato | null = null;
let cacheParticipantes: InterfaceAbi | null = null;

function caminhoDoArtefato(): string {
  return process.env.CAMINHO_ABI ?? CAMINHO_PADRAO;
}

export function carregarArtefato(): ArtefatoDoContrato {
  if (cache) return cache;
  cache = JSON.parse(readFileSync(caminhoDoArtefato(), "utf8")) as ArtefatoDoContrato;
  return cache;
}

export function abiDoContrato(): InterfaceAbi {
  return carregarArtefato().abi;
}

export function bytecodeDoContrato(): string {
  return carregarArtefato().bytecode;
}

export function abiDoRegistroDeParticipantes(): InterfaceAbi {
  if (cacheParticipantes) return cacheParticipantes;
  const caminho = process.env.CAMINHO_ABI_PARTICIPANTES ?? "artifacts/contracts/RegistroDeParticipantes.sol/RegistroDeParticipantes.json";
  cacheParticipantes = (JSON.parse(readFileSync(caminho, "utf8")) as ArtefatoDoContrato).abi;
  return cacheParticipantes;
}