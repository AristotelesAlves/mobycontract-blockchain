#!/usr/bin/env node
"use strict";

/**
 * Onboarding de um participante do consorcio para escrita assinada.
 *
 * Faz as tres coisas que tornam a parte capaz de assinar suas proprias
 * ancoragens, sem reiniciar a rede:
 *
 *   1. gera (ou aceita) uma chave e a publica no Web3Signer como arquivo
 *      `file-raw` em besu/web3signer/;
 *   2. adiciona o endereco a allowlist de contas dos 4 nos via
 *      `perm_addAccountsToAllowlist` e persiste no permissions_config.toml do
 *      host (fonte da verdade relida a cada subida);
 *   3. registra o membro no contrato RegistroDeParticipantes com o papel
 *      escolhido e, para quem ancora, concede registrador no ledger - as duas
 *      fechaduras do `somenteRegistrador` - assinando com a governanca.
 *
 * Uso:
 *   npm run participante -- <nome> [chave-privada]
 *   (equivale a: node besu/adicionar-participante.js <nome> [chave-privada])
 *
 * Variaveis:
 *   PAPEL=Registrador|Parte   (padrao: Registrador)
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
const PAPEIS = { Governanca: 1, Registrador: 2, Parte: 3 };

function falhar(mensagem) {
  console.error(`erro: ${mensagem}`);
  process.exit(1);
}

const nome = process.argv[2];
if (!nome) falhar("informe o nome do participante: node besu/adicionar-participante.js <nome> [chave]");
if (!/^[a-zA-Z0-9_-]+$/.test(nome)) falhar("o nome deve conter apenas letras, numeros, '-' ou '_'");

const papelNome = process.env.PAPEL ?? "Registrador";
const papel = PAPEIS[papelNome];
if (!papel) falhar(`papel invalido: ${papelNome} (use Registrador ou Parte)`);

if (!fs.existsSync(path.join(rede, "permissions_config.toml"))) {
  falhar("rede nao gerada; rode antes: sh besu/gerar-rede.sh");
}

const carteira = process.argv[3]
  ? new Wallet(process.argv[3].startsWith("0x") ? process.argv[3] : `0x${process.argv[3]}`)
  : Wallet.createRandom();
const endereco = getAddress(carteira.address);

fs.mkdirSync(web3signerDir, { recursive: true });
const arquivoChave = path.join(web3signerDir, `${nome}.yaml`);
fs.writeFileSync(
  arquivoChave,
  `type: "file-raw"\nkeyType: "SECP256K1"\nprivateKey: "${carteira.privateKey}"\n`
);
console.log(`chave gravada em ${arquivoChave}`);
console.log(`endereco da parte: ${endereco}`);

const caminhoPermissoes = path.join(rede, "permissions_config.toml");
const conteudo = fs.readFileSync(caminhoPermissoes, "utf8");
const linhaContas = conteudo.match(/accounts-allowlist\s*=\s*\[([^\]]*)\]/);
if (!linhaContas) falhar(`nao encontrei accounts-allowlist em ${caminhoPermissoes}`);

const contas = linhaContas[1]
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => item.replace(/^"|"$/g, ""));

if (!contas.some((conta) => conta.toLowerCase() === endereco.toLowerCase())) {
  contas.push(endereco);
  const novaLista = contas.map((conta) => `"${conta}"`).join(", ");
  fs.writeFileSync(caminhoPermissoes, conteudo.replace(linhaContas[0], `accounts-allowlist = [${novaLista}]`));
  console.log(`allowlist do host atualizada (${contas.length} contas)`);
} else {
  console.log("endereco ja constava na allowlist do host");
}

const portas = (process.env.RPC_URLS ?? "8545,8546,8547,8548").split(",").map((p) => p.trim()).filter(Boolean);

async function rpc(porta, method, params) {
  const resposta = await fetch(`http://127.0.0.1:${porta}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const corpo = await resposta.json();
  if (corpo.error) throw new Error(`porta ${porta}: ${corpo.error.message ?? JSON.stringify(corpo.error)}`);
  return corpo.result;
}

function lerArtefato(relativo) {
  return JSON.parse(fs.readFileSync(path.join(path.resolve(raiz, ".."), relativo), "utf8"));
}

async function registrarNoContrato() {
  const registro = lerArtefato(path.join("deployments", `${CHAIN_ID}.json`));
  const enderecoParticipantes = registro.participantes?.address;
  const enderecoLedger = registro.address;
  if (!enderecoParticipantes || !enderecoLedger) falhar("deployment incompleto: falta RegistroDeParticipantes ou ledger");

  const chaveDeployer = fs.readFileSync(path.join(rede, "keys", registro.deployer.toLowerCase(), "key"), "utf8").trim();
  const provider = new JsonRpcProvider(`http://127.0.0.1:${portas[0]}`, undefined, { staticNetwork: true });
  const governanca = new Wallet(chaveDeployer, provider);

  const redeAtual = Number((await provider.getNetwork()).chainId);
  if (redeAtual !== CHAIN_ID) falhar(`chainId ${redeAtual} != esperado ${CHAIN_ID}`);

  const participantes = new Contract(enderecoParticipantes, lerArtefato("artifacts/contracts/RegistroDeParticipantes.sol/RegistroDeParticipantes.json").abi, governanca);
  const txHab = await participantes.habilitar(endereco, papel);
  const reciboHab = await txHab.wait();
  console.log(`habilitado no consorcio em ${enderecoParticipantes} (papel ${papelNome}), tx ${txHab.hash}, status ${reciboHab.status}`);

  if (papel !== PAPEIS.Parte) {
    const ledger = new Contract(enderecoLedger, lerArtefato("artifacts/contracts/MobyContractRegistry.sol/MobyContractRegistry.json").abi, governanca);
    const txReg = await ledger.concederRegistrador(endereco);
    const reciboReg = await txReg.wait();
    console.log(`concederRegistrador no ledger ${enderecoLedger}, tx ${txReg.hash}, status ${reciboReg.status}`);
  }
}

async function main() {
  for (const porta of portas) {
    const resultado = await rpc(porta, "perm_addAccountsToAllowlist", [[endereco]]);
    console.log(`allowlist do no na porta ${porta}: ${resultado}`);
  }

  try {
    await registrarNoContrato();
  } catch (erro) {
    console.error(`aviso: falha ao registrar no contrato: ${erro.shortMessage ?? erro.message}`);
  }

  try {
    execFileSync("docker", ["restart", process.env.WEB3SIGNER_CONTAINER ?? "moby-web3signer"], { stdio: "ignore" });
    console.log("web3signer reiniciado para carregar a nova chave");
  } catch {
    console.error("aviso: reinicie o Web3Signer manualmente para carregar a nova chave");
  }

  console.log(`ok. A parte ${endereco} ja pode ancorar assinando via Web3Signer (configure WEB3SIGNER_URL no registry).`);
}

main().catch((erro) => falhar(erro.shortMessage ?? erro.message));
