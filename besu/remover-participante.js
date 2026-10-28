#!/usr/bin/env node
"use strict";

/**
 * Offboarding: desfaz o onboarding de um participante do consorcio.
 *
 * Remove as tres coisas que o `adicionar-participante.js` liga, sem reiniciar a
 * rede:
 *
 *   1. tira o endereco da allowlist de contas dos 4 nos
 *      (`perm_removeAccountsFromAllowlist`) e do permissions_config.toml do host;
 *   2. encerra o membro no consorcio (RegistroDeParticipantes.tornarExCliente) e
 *      revoga o registrador no ledger (MobyContractRegistry.revogarRegistrador),
 *      assinando com a governanca;
 *   3. apaga a chave de `besu/web3signer/` e reinicia o Web3Signer.
 *
 * O historico que o participante ja ancorou continua legivel: a EVM nao apaga.
 * A remocao so tira o direito de escrever de novo.
 *
 * Uso:
 *   npm run participante:remover -- <nome>
 *   npm run participante:remover -- 0x<endereco>
 *
 * Variaveis:
 *   RPC_URLS=8545,8546,...    (padrao: 8545..8548)
 *   WEB3SIGNER_CONTAINER=moby-web3signer
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Wallet, JsonRpcProvider, Contract, getAddress } = require("ethers");

const raiz = path.resolve(__dirname);
const rede = path.join(raiz, "rede");
const web3signerDir = path.join(raiz, "web3signer");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "20250101");
const PORTAS = (process.env.RPC_URLS ?? "8545,8546,8547,8548").split(",").map((p) => Number(p.trim())).filter(Boolean);

function falhar(mensagem) {
  console.error(`erro: ${mensagem}`);
  process.exit(1);
}

function rpc(porta, method, params) {
  return fetch(`http://127.0.0.1:${porta}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
    .then((resposta) => resposta.json())
    .then((corpo) => {
      if (corpo.error) throw new Error(`porta ${porta}: ${corpo.error.message ?? JSON.stringify(corpo.error)}`);
      return corpo.result;
    });
}

function lerArtefato(relativo) {
  return JSON.parse(fs.readFileSync(path.join(path.resolve(raiz, ".."), relativo), "utf8"));
}

const alvo = process.argv[2];
if (!alvo) falhar("informe o nome ou o endereco: npm run participante:remover -- <nome|0xendereco>");

if (!fs.existsSync(path.join(rede, "permissions_config.toml"))) {
  falhar("rede nao gerada; rode antes: sh besu/gerar-rede.sh");
}

const arquivoChave = path.join(web3signerDir, `${alvo}.yaml`);
let endereco;
const chaveExiste = fs.existsSync(arquivoChave);
const conteudoChave = chaveExiste ? fs.readFileSync(arquivoChave, "utf8") : null;
const privada = conteudoChave?.match(/privateKey:\s*"([^"]+)"/)?.[1];

if (chaveExiste && !privada) falhar(`nao encontrei privateKey em ${arquivoChave}`);

if (privada) {
  endereco = getAddress(new Wallet(privada).address);
} else if (/^0x[0-9a-fA-F]{40}$/.test(alvo)) {
  endereco = getAddress(alvo);
} else {
  falhar(`sem chave em ${arquivoChave} e "${alvo}" nao e um endereco valido`);
}
console.log(`removendo participante ${endereco}`);

const caminhoPermissoes = path.join(rede, "permissions_config.toml");
const conteudo = fs.readFileSync(caminhoPermissoes, "utf8");
const linhaContas = conteudo.match(/accounts-allowlist\s*=\s*\[([^\]]*)\]/);
if (!linhaContas) falhar(`nao encontrei accounts-allowlist em ${caminhoPermissoes}`);

const contas = linhaContas[1]
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => item.replace(/^"|"$/g, ""));
const restantes = contas.filter((conta) => conta.toLowerCase() !== endereco.toLowerCase());

if (restantes.length !== contas.length) {
  fs.writeFileSync(caminhoPermissoes, conteudo.replace(linhaContas[0], `accounts-allowlist = [${restantes.map((c) => `"${c}"`).join(", ")}]`));
  console.log(`allowlist do host atualizada (${contas.length} -> ${restantes.length} contas)`);
} else {
  console.log("endereco nao estava na allowlist do host");
}

async function main() {
  for (const porta of PORTAS) {
    const resultado = await rpc(porta, "perm_removeAccountsFromAllowlist", [[endereco]]);
    console.log(`allowlist do no na porta ${porta}: ${resultado}`);
  }

  const registro = lerArtefato(path.join("deployments", `${CHAIN_ID}.json`));
  const chaveDeployer = fs.readFileSync(path.join(rede, "keys", registro.deployer.toLowerCase(), "key"), "utf8").trim();
  const provider = new JsonRpcProvider(`http://127.0.0.1:${PORTAS[0]}`, undefined, { staticNetwork: true });
  const governanca = new Wallet(chaveDeployer, provider);

  const redeAtual = Number((await provider.getNetwork()).chainId);
  if (redeAtual !== CHAIN_ID) falhar(`chainId ${redeAtual} != esperado ${CHAIN_ID}`);

  const ledger = new Contract(registro.address, lerArtefato("artifacts/contracts/MobyContractRegistry.sol/MobyContractRegistry.json").abi, governanca);
  if (await ledger.registradores(endereco)) {
    const tx = await ledger.revogarRegistrador(endereco);
    const recibo = await tx.wait();
    console.log(`revogarRegistrador no ledger ${registro.address}, tx ${tx.hash}, status ${recibo.status}`);
  } else {
    console.log("endereco nao era registrador no ledger");
  }

  if (registro.participantes?.address) {
    const participantes = new Contract(registro.participantes.address, lerArtefato("artifacts/contracts/RegistroDeParticipantes.sol/RegistroDeParticipantes.json").abi, governanca);
    try {
      const tx = await participantes.tornarExCliente(endereco);
      const recibo = await tx.wait();
      console.log(`tornarExCliente no consorcio ${registro.participantes.address}, tx ${tx.hash}, status ${recibo.status}`);
    } catch (erro) {
      console.error(`aviso: nao encerrei no consorcio (talvez nao houvesse membro): ${erro.shortMessage ?? erro.message}`);
    }
  }

  if (fs.existsSync(arquivoChave)) {
    fs.rmSync(arquivoChave);
    console.log(`chave removida de ${arquivoChave}`);
  }

  try {
    execFileSync("docker", ["restart", process.env.WEB3SIGNER_CONTAINER ?? "moby-web3signer"], { stdio: "ignore" });
    console.log("web3signer reiniciado para descarregar a chave");
  } catch {
    console.error("aviso: reinicie o Web3Signer manualmente para descarregar a chave");
  }

  console.log(`ok. ${endereco} nao escreve mais; o historico ancorado permanece legivel.`);
}

main().catch((erro) => falhar(erro.shortMessage ?? erro.message));
