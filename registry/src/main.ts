import { ServicoDeAncoragem } from "./aplicacao/servico-de-ancoragem";
import { ServicoDeAutenticacao } from "./aplicacao/servico-de-autenticacao";
import { ServicoDeParticipantes } from "./aplicacao/servico-de-participantes";
import { criarApp } from "./http/servidor";
import { AdministracaoDeParticipantes } from "./infra/administracao-de-participantes";
import { abrirBanco, type ConfiguracaoBanco } from "./infra/banco";
import {
  carregarConfiguracao,
  carregarConfiguracaoDeParticipantes,
  configuracaoDoBanco,
  exigirCredenciaisAdmin,
  exigirSalDePseudonimo,
  exigirSegredoJwt,
  expiracaoDoToken,
  portaDoServico,
} from "./infra/configuracao";
import { log } from "./infra/log";
import { RegistroClient } from "./infra/registro-client";
import { RepositorioDeChaves } from "./infra/repositorio-chaves";
import { SegurancaNode } from "./infra/seguranca";
import { Pool } from "pg";

/**
 * Composicao raiz do registry service.
 *
 * E o unico lugar do projeto que conhece todas as camadas ao mesmo tempo:
 * monta a porta (infra), injeta no caso de uso (aplicacao) e liga no HTTP.
 * Todo o resto recebe suas dependencias por construtor.
 */

async function main(): Promise<void> {
  exigirSalDePseudonimo();

  const servico = new ServicoDeAncoragem(new RegistroClient(carregarConfiguracao()));

  const configBanco: ConfiguracaoBanco = configuracaoDoBanco();
  const pool: Pool = await abrirBanco(configBanco);
  const chaves = new RepositorioDeChaves(pool);
  const seguranca = new SegurancaNode(exigirSegredoJwt());
  const autenticacao = new ServicoDeAutenticacao(chaves, seguranca, exigirCredenciaisAdmin(), expiracaoDoToken());

  const configuracaoDeParticipantes = carregarConfiguracaoDeParticipantes();
  const participantes = configuracaoDeParticipantes
    ? new ServicoDeParticipantes(new AdministracaoDeParticipantes(configuracaoDeParticipantes))
    : undefined;

  const app = criarApp(servico, { chaveApi: process.env.CHAVE_API, autenticacao, participantes });
  const porta = portaDoServico();

  if (participantes) {
    log.info("administracao de participantes habilitada (POST/DELETE /participantes)");
  } else {
    log.info("administracao de participantes desabilitada (defina ENDERECO_PARTICIPANTES ou implante o consorcio)");
  }

  try {
    const rede = await servico.saude();
    log.info({ ...rede }, rede.status === "ok" ? "conectado a ledger" : "ATENCAO: chainId inesperado");
  } catch (erro) {
    log.warn({ erro: String(erro) }, "ainda sem conexao com a ledger; leitura falhara ate o no subir");
  }

  const shutdown = async () => {
    log.info("encerrando conexoes com o banco de dados");
    await pool.end();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  app.listen(porta, "0.0.0.0", () => log.info({ porta }, "registry service no ar"));
}

main().catch((erro) => {
  log.error({ erro: String(erro) }, "falha ao iniciar o registry service");
  process.exit(1);
});
