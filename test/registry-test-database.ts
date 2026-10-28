import { Pool } from "pg";
import { abrirBanco, type ConfiguracaoBanco } from "../registry/src/infra/banco";

function configuracaoBancoDeTeste(): ConfiguracaoBanco {
  return {
    host: process.env.TEST_DB_HOST ?? "localhost",
    port: Number(process.env.TEST_DB_PORT ?? "5432"),
    database: process.env.TEST_DB_NAME ?? "registry_test",
    user: process.env.TEST_DB_USER ?? process.env.POSTGRES_USER ?? "postgres",
    password: process.env.TEST_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? "postgres",
    max: 5,
  };
}

export async function abrirBancoDeTeste(): Promise<Pool> {
  const pool = await abrirBanco(configuracaoBancoDeTeste());
  await pool.query("DELETE FROM api_keys");

  return pool;
}
