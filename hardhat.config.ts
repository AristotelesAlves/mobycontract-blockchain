import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HardhatUserConfig } from "hardhat/config";
import type { MochaOptions } from "mocha";
import "@nomicfoundation/hardhat-toolbox";

const AMOY_RPC = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "11".repeat(32);

const BESU_RPC = process.env.BESU_RPC_URL ?? "http://127.0.0.1:8545";
const BESU_CHAIN_ID = Number(process.env.BESU_CHAIN_ID ?? 20250101);
const BESU_DIR = join(__dirname, "besu", "rede", "keys");

/**
 * Chaves dos validadores geradas por besu/gerar-rede.sh. Como sao locais e
 * efemeras, o Hardhat as le direto do disco quando a rede ja foi gerada; sem
 * elas a lista fica vazia e so transacoes assinadas fora do Hardhat funcionam.
 */
function chavesDosValidadores(): string[] {
  if (!existsSync(BESU_DIR)) return [];

  return readdirSync(BESU_DIR)
    .sort()
    .map((endereco) => join(BESU_DIR, endereco, "key"))
    .filter(existsSync)
    .map((caminho) => "0x" + readFileSync(caminho, "utf8").trim().replace(/^0x/i, ""));
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",

      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      blockGasLimit: 30_000_000,
      hardfork: "cancun",
    },
    localhost: {
      url: process.env.RPC_URL ?? "http://127.0.0.1:8545",
      chainId: Number(process.env.CHAIN_ID_ESPERADO ?? 31337),
    },
    amoy: {
      url: AMOY_RPC,
      chainId: 80002,
      accounts: DEPLOYER_KEY === "0x" + "11".repeat(32) ? [] : [DEPLOYER_KEY],
      gasPrice: 30_000_000_000,
    },
    besu: {
      url: BESU_RPC,
      chainId: BESU_CHAIN_ID,
      accounts: process.env.BESU_PRIVATE_KEY ? [process.env.BESU_PRIVATE_KEY] : chavesDosValidadores(),
      gasPrice: 0,
    },
  },
  paths: {
    sources: "contracts",
    tests: "test",
    cache: ".hardhat-cache",
    artifacts: "artifacts",
  },
  mocha: { timeout: 180_000 } as MochaOptions,
};

export default config;
