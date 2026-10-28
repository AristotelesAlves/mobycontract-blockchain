import { Pool, PoolConfig } from "pg";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS api_keys (
  id                   SERIAL PRIMARY KEY,
  nome                 TEXT    NOT NULL,
  prefixo              TEXT    NOT NULL,
  hash                 TEXT    NOT NULL UNIQUE,
  endereco             TEXT,
  criado_em            TEXT    NOT NULL,
  expira_em            TEXT,
  revogada_em          TEXT,
  ultima_utilizacao_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (hash);
`;

const MIGRACOES: ReadonlyArray<{ coluna: string; sql: string }> = [
  { coluna: "endereco", sql: "ALTER TABLE api_keys ADD COLUMN endereco TEXT" },
];

async function migrar(pool: Pool): Promise<void> {
  const result = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'api_keys'");
  const colunas = new Set(result.rows.map((row) => row.column_name));
  for (const migracao of MIGRACOES) {
    if (!colunas.has(migracao.coluna)) {
      await pool.query(migracao.sql);
    }
  }
}

export interface ConfiguracaoBanco {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
  max?: number;
}

export async function abrirBanco(config: ConfiguracaoBanco): Promise<Pool> {
  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: config.max ?? 10,
  };

  if (config.ssl) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  const pool = new Pool(poolConfig);

  await pool.query(ESQUEMA);
  await migrar(pool);
  return pool;
}