import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "hardhat";

interface ContratoImplantado {
  address: string;
  txHash: string | null;
}

interface RegistroDeDeployment {
  address: string;
  deployer: string;
  chainId: number;
  deployedAt: string;
  txHash: string | null;
  participantes?: ContratoImplantado;
  controladorDeAcesso?: string | null;
}

function caminhoDoDeployment(chainId: number): string {
  return `deployments/${chainId}.json`;
}

function lerDeployment(chainId: number): RegistroDeDeployment | null {
  const caminho = caminhoDoDeployment(chainId);
  if (!existsSync(caminho)) return null;
  return JSON.parse(readFileSync(caminho, "utf8")) as RegistroDeDeployment;
}

function salvarDeployment(chainId: number, registro: RegistroDeDeployment): void {
  mkdirSync("deployments", { recursive: true });
  writeFileSync(caminhoDoDeployment(chainId), `${JSON.stringify(registro, null, 2)}\n`);
}

async function implantarParticipantes(deployer: Awaited<ReturnType<typeof ethers.getSigners>>[number]) {
  const fabrica = await ethers.getContractFactory("RegistroDeParticipantes", deployer);
  const contrato = await fabrica.deploy();
  await contrato.waitForDeployment();
  return contrato;
}

/**
 * Deploy do ledger e, no mesmo passo, do registro de participantes do consorcio.
 *
 * Com WIRAR_CONTROLADOR=true o ledger passa a exigir participante ativo para
 * ancorar (o deployer vira a governanca inicial). Sem a flag, so implanta os
 * dois e deixa o vinculo explicito para o operador decidir quando ligar.
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("nenhuma conta disponivel: configure DEPLOYER_PRIVATE_KEY (ou gere a rede Besu)");

  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const anterior = lerDeployment(chainId);

  if (anterior && (await ethers.provider.getCode(anterior.address)) !== "0x") {
    console.log(`ledger ja implantado em ${anterior.address} (chainId ${chainId}), deployer ${anterior.deployer}`);
    return;
  }

  if (anterior) console.log(`endereco registrado ${anterior.address} esta sem codigo; implantando novamente`);

  const participantes = await implantarParticipantes(deployer);
  const enderecoParticipantes = await participantes.getAddress();

  const fabrica = await ethers.getContractFactory("MobyContractRegistry", deployer);
  const contrato = await fabrica.deploy();
  await contrato.waitForDeployment();
  const address = await contrato.getAddress();

  const wirar = process.env.WIRAR_CONTROLADOR === "true";
  let controladorDeAcesso: string | null = null;
  if (wirar) {
    const tx = await contrato.definirControladorDeAcesso(enderecoParticipantes);
    await tx.wait();
    controladorDeAcesso = enderecoParticipantes;
  }

  salvarDeployment(chainId, {
    address,
    deployer: deployer.address,
    chainId,
    deployedAt: new Date().toISOString(),
    txHash: contrato.deploymentTransaction()?.hash ?? null,
    participantes: {
      address: enderecoParticipantes,
      txHash: participantes.deploymentTransaction()?.hash ?? null,
    },
    controladorDeAcesso,
  });

  console.log(`MobyContractRegistry implantado em ${address}`);
  console.log(`RegistroDeParticipantes implantado em ${enderecoParticipantes}`);
  console.log(`controlador de acesso: ${controladorDeAcesso ?? "desligado (WIRAR_CONTROLADOR=true para ligar)"}`);
  console.log(`chainId: ${chainId}`);
  console.log(`deployer: ${deployer.address}`);
  console.log(`totalContratos inicial: ${await contrato.totalContratos()}`);
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
