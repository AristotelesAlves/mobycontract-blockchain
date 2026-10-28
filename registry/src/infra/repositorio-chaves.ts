import { Pool } from "pg";
import type { ChaveApiRegistrada, NovaChaveApi, PortaDeChaves } from "../aplicacao/porta-chaves";

interface Linha {
  id: number;
  nome: string;
  prefixo: string;
  endereco: string | null;
  criado_em: string;
  expira_em: string | null;
  revogada_em: string | null;
  ultima_utilizacao_em: string | null;
}

function paraRegistro(linha: Linha): ChaveApiRegistrada {
  return {
    id: linha.id,
    nome: linha.nome,
    prefixo: linha.prefixo,
    endereco: linha.endereco,
    criadoEm: linha.criado_em,
    expiraEm: linha.expira_em,
    revogadaEm: linha.revogada_em,
    ultimaUtilizacaoEm: linha.ultima_utilizacao_em,
  };
}

export class RepositorioDeChaves implements PortaDeChaves {
  constructor(private readonly pool: Pool) {}

  async criar(nova: NovaChaveApi): Promise<ChaveApiRegistrada> {
    const resultado = await this.pool.query(
      "INSERT INTO api_keys (nome, prefixo, hash, endereco, criado_em, expira_em) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
      [nova.nome, nova.prefixo, nova.hash, nova.endereco, nova.criadoEm, nova.expiraEm]
    );

    return {
      id: resultado.rows[0].id,
      nome: nova.nome,
      prefixo: nova.prefixo,
      endereco: nova.endereco,
      criadoEm: nova.criadoEm,
      expiraEm: nova.expiraEm,
      revogadaEm: null,
      ultimaUtilizacaoEm: null,
    };
  }

  async listar(): Promise<ChaveApiRegistrada[]> {
    const resultado = await this.pool.query("SELECT * FROM api_keys ORDER BY id DESC");
    return resultado.rows.map(paraRegistro);
  }

  async buscarPorHash(hash: string): Promise<ChaveApiRegistrada | null> {
    const resultado = await this.pool.query("SELECT * FROM api_keys WHERE hash = $1", [hash]);
    return resultado.rows[0] ? paraRegistro(resultado.rows[0]) : null;
  }

  async revogar(id: number, quando: string): Promise<boolean> {
    const resultado = await this.pool.query(
      "UPDATE api_keys SET revogada_em = $1 WHERE id = $2 AND revogada_em IS NULL",
      [quando, id]
    );

    return resultado.rowCount !== null && resultado.rowCount > 0;
  }

  async registrarUso(id: number, quando: string): Promise<void> {
    await this.pool.query("UPDATE api_keys SET ultima_utilizacao_em = $1 WHERE id = $2", [quando, id]);
  }
}