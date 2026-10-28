"use strict";

/**
 * Deriva permissoes_config.toml e o .env dos enodes a partir das chaves que o
 * `besu operator generate-blockchain-config` gerou.
 *
 * - accounts-allowlist: enderecos dos validadores (mais CONTAS_EXTRA, se houver)
 * - nodes-allowlist:    enodes dos validadores, no IP fixo da rede do compose
 *                       (IP_BASE, validador-N fica com o octeto base+N-1)
 *
 * O Besu recusa hostname no enode (exige IP), por isso o compose atribui um IP
 * estatico a cada validador e o enode usa esse IP.
 *
 * Nao guarda segredo nenhum: enode e endereco sao publicos.
 */

const fs = require("node:fs");
const path = require("node:path");

const raiz = path.resolve(__dirname);
const rede = path.resolve(process.argv[2] ?? path.join(raiz, "rede"));
const keysDir = path.join(rede, "keys");

const ipBase = process.env.IP_BASE ?? "172.28.0.11";
const octetos = ipBase.split(".");
const ipDoValidador = (indice) =>
  `${octetos[0]}.${octetos[1]}.${octetos[2]}.${Number(octetos[3]) + indice}`;

if (!fs.existsSync(keysDir)) {
  console.error(`nao encontrei ${keysDir}: rode o gerador do Besu primeiro`);
  process.exit(1);
}

const semPrefixo = (valor) => valor.trim().replace(/^0x/i, "");

const pastas = fs.readdirSync(keysDir).sort();
const enderecos = pastas.map(semPrefixo);

if (pastas.length === 0) {
  console.error(`nenhuma chave em ${keysDir}`);
  process.exit(1);
}

const contas = enderecos.map((endereco) => `"0x${endereco}"`);
const nos = [];
const env = [];

pastas.forEach((pasta, indice) => {
  const pub = semPrefixo(fs.readFileSync(path.join(keysDir, pasta, "key.pub"), "utf8"));
  const enode = `enode://${pub}@${ipDoValidador(indice)}:30303`;
  nos.push(`"${enode}"`);
  env.push(`ENODE_VALIDADOR_${indice + 1}=${enode}`);
});

const extra = (process.env.CONTAS_EXTRA ?? "")
  .split(",")
  .map((valor) => valor.trim())
  .filter(Boolean)
  .map((valor) => `"${valor.startsWith("0x") ? valor : `0x${valor}`}"`);

const toml = [
  "# gerado por gerar-permissoes.js - nao editar a mao",
  `accounts-allowlist = [${[...contas, ...extra].join(", ")}]`,
  `nodes-allowlist = [${nos.join(", ")}]`,
  "",
].join("\n");

fs.writeFileSync(path.join(rede, "permissions_config.toml"), toml);
fs.writeFileSync(path.join(raiz, ".env"), `${env.join("\n")}\n`);

console.log(`permissoes geradas: ${enderecos.length} validadores (${enderecos.length + extra.length} contas permitidas)`);
