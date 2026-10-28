import type { CredenciaisAdmin } from "../dominio/credenciais";
import type { PedidoDeChaveApi } from "../dominio/dto/pedido-chave-api";
import type { PedidoDeLogin } from "../dominio/dto/pedido-login";
import { chaveApiNaoEncontrada, credenciaisInvalidas } from "../dominio/erro";
import type { PortaDeChaves, ChaveApiRegistrada } from "./porta-chaves";
import type { ClaimsDeToken, PortaDeSeguranca } from "./porta-seguranca";

/**
 * Servico de autenticacao: login do administrador e ciclo de vida das API keys.
 *
 * O login so existe para um administrador; o que ele emite e revoga sao chaves
 * de API, que e o que autentica as rotas de ancoragem. A senha nunca e
 * comparada em texto plano (a porta recebe o hash) e a chave so aparece
 * completa uma vez, na criacao - depois so o hash fica guardado.
 */

export interface LoginConcluido {
  token: string;
  tipo: "Bearer";
  expiraEm: string;
}

export interface ChaveApiEmitida {
  chave: string;
  registro: ChaveApiRegistrada;
}

export interface ChaveApiAutenticada {
  id: number;
  endereco: string | null;
}

export class ServicoDeAutenticacao {
  constructor(
    private readonly chaves: PortaDeChaves,
    private readonly seguranca: PortaDeSeguranca,
    private readonly admin: CredenciaisAdmin,
    private readonly expiracaoSegundos: number
  ) {}

  async login(pedido: PedidoDeLogin): Promise<LoginConcluido> {
    const usuarioConfere = pedido.usuario === this.admin.usuario;
    const senhaConfere = this.seguranca.conferirSenha(pedido.senha, this.admin.senhaHash);

    if (!usuarioConfere || !senhaConfere) throw credenciaisInvalidas();

    const { token, expiraEm } = this.seguranca.assinarToken(this.admin.usuario, this.expiracaoSegundos);
    return { token, tipo: "Bearer", expiraEm };
  }

  async criarChaveApi(pedido: PedidoDeChaveApi): Promise<ChaveApiEmitida> {
    const chave = this.seguranca.gerarChaveApi();
    const registro = await this.chaves.criar({
      nome: pedido.nome,
      prefixo: chave.slice(0, 12),
      hash: this.seguranca.hashDeChaveApi(chave),
      endereco: pedido.endereco,
      criadoEm: new Date().toISOString(),
      expiraEm: pedido.expiraEm,
    });

    return { chave, registro };
  }

  async listarChaves(): Promise<ChaveApiRegistrada[]> {
    return this.chaves.listar();
  }

  async revogarChave(id: number): Promise<void> {
    const revogada = await this.chaves.revogar(id, new Date().toISOString());
    if (!revogada) throw chaveApiNaoEncontrada(id);
  }

  async autenticarChaveApi(chave: string): Promise<ChaveApiAutenticada | null> {
    const registro = await this.chaves.buscarPorHash(this.seguranca.hashDeChaveApi(chave));
    if (!registro || registro.revogadaEm) return null;
    if (registro.expiraEm && registro.expiraEm <= new Date().toISOString()) return null;

    await this.chaves.registrarUso(registro.id, new Date().toISOString());
    return { id: registro.id, endereco: registro.endereco };
  }

  verificarToken(token: string): ClaimsDeToken | null {
    return this.seguranca.verificarToken(token);
  }
}
