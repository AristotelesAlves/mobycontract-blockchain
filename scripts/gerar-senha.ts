import { gerarHashDeSenha } from "../registry/src/infra/seguranca";

/**
 * Gera o hash scrypt para `ADMIN_SENHA_HASH`, sem deixar a senha em texto plano
 * no ambiente.
 *
 *   npm run gerar:senha -- "minha-senha"
 */

const senha = process.argv[2] ?? process.env.ADMIN_SENHA;

if (!senha) {
  console.error('uso: npm run gerar:senha -- "minha-senha"');
  process.exit(1);
}

process.stdout.write(`${gerarHashDeSenha(senha)}\n`);
