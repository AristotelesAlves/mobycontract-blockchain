import { AbstractSigner, toBeHex, type Provider, type TransactionRequest, type TransactionResponse, type TypedDataDomain, type TypedDataField } from "ethers";

/**
 * Assinador remoto sobre o Web3Signer.
 *
 * O registry nao guarda a chave privada da parte: ele monta a transacao, manda
 * ao Web3Signer por JSON-RPC (`eth_signTransaction`) e recebe de volta a
 * transacao assinada, que ele proprio transmite ao no Besu. Assim o `msg.sender`
 * on-chain e o endereco da parte autenticada, e nao a carteira do servico.
 *
 * Implementa `AbstractSigner` do ethers para entrar em `contrato.connect(...)`
 * como qualquer outra carteira.
 */

interface RespostaJsonRpc {
  result?: string;
  error?: { message?: string };
}

export class AssinadorWeb3Signer extends AbstractSigner {
  private readonly enderecoAssinante: string;

  constructor(
    private readonly url: string,
    endereco: string,
    provider: Provider
  ) {
    super(provider);
    this.enderecoAssinante = endereco;
  }

  async getAddress(): Promise<string> {
    return this.enderecoAssinante;
  }

  connect(provider: Provider | null): AssinadorWeb3Signer {
    if (!provider) throw new Error("AssinadorWeb3Signer exige um provider para transmitir a transacao");
    return new AssinadorWeb3Signer(this.url, this.enderecoAssinante, provider);
  }

  async sendTransaction(transacao: TransactionRequest): Promise<TransactionResponse> {
    if (!this.provider) throw new Error("AssinadorWeb3Signer sem provider para transmitir a transacao");

    const populada = await this.populateTransaction(transacao);
    const assinada = await this.assinar(populada as TransactionRequest);
    return this.provider.broadcastTransaction(assinada);
  }

  async signTransaction(transacao: TransactionRequest): Promise<string> {
    return this.assinar(transacao);
  }

  async signMessage(): Promise<string> {
    throw new Error("AssinadorWeb3Signer assina apenas transacoes");
  }

  async signTypedData(_domain: TypedDataDomain, _types: Record<string, TypedDataField[]>, _value: Record<string, unknown>): Promise<string> {
    throw new Error("AssinadorWeb3Signer assina apenas transacoes");
  }

  private async assinar(transacao: TransactionRequest): Promise<string> {
    const resposta = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_signTransaction", params: [this.paraJsonRpc(transacao)] }),
    });

    const corpo = (await resposta.json()) as RespostaJsonRpc;
    if (corpo.error) throw new Error(`web3signer recusou a transacao de ${this.enderecoAssinante}: ${corpo.error.message ?? "erro desconhecido"}`);
    if (!corpo.result) throw new Error(`web3signer nao devolveu a transacao assinada de ${this.enderecoAssinante}`);

    return corpo.result;
  }

  private paraJsonRpc(transacao: TransactionRequest): Record<string, string> {
    const corpo: Record<string, string> = { from: this.enderecoAssinante };

    if (transacao.to != null) corpo.to = String(transacao.to);
    if (transacao.data != null) corpo.data = String(transacao.data);
    if (transacao.nonce != null) corpo.nonce = this.hex(transacao.nonce);
    if (transacao.gasLimit != null) corpo.gas = this.hex(transacao.gasLimit);
    if (transacao.value != null) corpo.value = this.hex(transacao.value);
    if (transacao.chainId != null) corpo.chainId = this.hex(transacao.chainId);
    if (transacao.type != null) corpo.type = this.hex(transacao.type);

    if (transacao.gasPrice != null) corpo.gasPrice = this.hex(transacao.gasPrice);
    if (transacao.gasPrice == null && transacao.maxFeePerGas != null) {
      corpo.maxFeePerGas = this.hex(transacao.maxFeePerGas);
    }
    if (transacao.gasPrice == null && transacao.maxPriorityFeePerGas != null) {
      corpo.maxPriorityFeePerGas = this.hex(transacao.maxPriorityFeePerGas);
    }

    return corpo;
  }

  private hex(valor: unknown): string {
    return typeof valor === "string" ? valor : toBeHex(valor as bigint);
  }
}
