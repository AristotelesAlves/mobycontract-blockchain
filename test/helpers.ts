import { Buffer } from "node:buffer";
import { expect } from "chai";
import { ethers } from "hardhat";
import type { BaseContract } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MobyContractRegistry__factory } from "../typechain-types";
import type { MobyContractRegistry } from "../typechain-types";
import { contratoIdOnChain, deterministicHash, deterministicHashV2, hashDocumentoBytes, hashPseudonimo, TIPO_HASH } from "../src/hashing";

export const SAL = "sal-de-teste-nao-usar-em-producao";

export const CONTRATO = {
  versao: 1,
  contratoId: "2026/0001",
  imovelId: "imovel-77",
  inquilinoId: "inquilino-31",
  dataInicio: "2026-02-01",
  dataFim: "2027-01-31",
  valorMensalCentavos: "185000",
  garantia: "Caução",
  modeloId: "modelo-locacao-v3",
} as const;

export const NOMES_SIGNERS = ["admin", "registrador", "outroRegistrador", "imobiliaria", "locador", "locatario", "fiador", "intruso"] as const;
export type NomeSigner = (typeof NOMES_SIGNERS)[number];

type Conta = HardhatEthersSigner;

export interface Ambiente {
  admin: Conta;
  registrador: Conta;
  outroRegistrador: Conta;
  imobiliaria: Conta;
  locador: Conta;
  locatario: Conta;
  fiador: Conta;
  intruso: Conta;
  endereco: (nome: NomeSigner) => Promise<string>;

  contrato: MobyContractRegistry;
}

export async function implantarRegistry(): Promise<Ambiente> {
  const [admin, registrador, outroRegistrador, imobiliaria, locador, locatario, fiador, intruso] = await ethers.getSigners();

  const contrato = await new MobyContractRegistry__factory(admin).deploy();
  await contrato.waitForDeployment();

  await (contrato as any).concederRegistrador(await registrador!.getAddress());
  await (contrato as any).concederRegistrador(await outroRegistrador!.getAddress());

  const contas = { admin, registrador, outroRegistrador, imobiliaria, locador, locatario, fiador, intruso } as unknown as Record<
    NomeSigner,
    Conta
  >;
  const endereco = async (nome: NomeSigner) => await contas[nome].getAddress();

  return { ...contas, endereco, contrato } as unknown as Ambiente;
}

export async function partesDoContrato(ambiente: Ambiente): Promise<{ imobiliaria: string; locador: string; locatario: string; todas: string[] }> {
  const imobiliaria = await ambiente.endereco("imobiliaria");
  const locador = await ambiente.endereco("locador");
  const locatario = await ambiente.endereco("locatario");
  return { imobiliaria, locador, locatario, todas: [imobiliaria, locador, locatario] };
}

export function hashDocumentoDeTeste(semente: string): string {
  return hashDocumentoBytes(Buffer.from(`%PDF-1.4\n% MobyContract ${semente}\n%%EOF\n`, "utf8"));
}

export interface SobrescreverContrato {
  contratoId?: string;
  tipoHash?: number;
  prazo?: number;
  indiceReajuste?: number;
  signer?: NomeSigner;
}

export async function ancorarContrato(ambiente: Ambiente, sobrescrever: SobrescreverContrato = {}) {
  const campos = sobrescrever.contratoId ? { ...CONTRATO, contratoId: sobrescrever.contratoId } : CONTRATO;
  const chave = contratoIdOnChain(campos.contratoId);
  const hashPdf = hashDocumentoDeTeste(campos.contratoId);
  const autor = ambiente[sobrescrever.signer ?? "registrador"];

  const tx = await ambiente.contrato.connect(autor).registrarContrato(
    campos.contratoId,
    deterministicHash(campos),
    deterministicHashV2(campos),
    hashPdf,
    hashPseudonimo(campos.inquilinoId, SAL),
    hashPseudonimo(campos.imovelId, SAL),
    sobrescrever.tipoHash ?? TIPO_HASH.PDF,
    sobrescrever.prazo ?? 365,
    sobrescrever.indiceReajuste ?? 0,
    hashPseudonimo(campos.modeloId, SAL),
    (await partesDoContrato(ambiente)).todas
  );

  return { chave, hash: hashPdf, tx, recibo: await tx.wait(), campos };
}

export async function esperarErroDoContrato(promessa: Promise<unknown>, contrato: BaseContract, nomeDoErro: string): Promise<void> {
  await expect(promessa).to.be.revertedWithCustomError(contrato as any, nomeDoErro);
}
