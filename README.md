# MobyContract Blockchain

Camada independente que responde ao problema de pesquisa: registrar de forma
imutavel evidencias criptograficas de contratos de locacao, permitindo verificar
posteriormente a integridade do documento sem publicar seu conteudo na cadeia.

O projeto contem contratos Solidity, rede EVM local (Anvil), Registry HTTP em
Node.js e testes Hardhat. O Registry e a unica interface consumida pelo produto
MobyContract; ele recebe somente hashes e metadados minimizados.

## Integracao com o produto

Os dois repositorios se comunicam pela rede Docker externa
`mobycontract-integracao`. O Registry e descoberto pelo nome `registry` e a API
Laravel usa `BLOCKCHAIN_REGISTRY_URL=http://registry:4000`. Nginx e o frontend
nao acessam a blockchain diretamente.

Crie a rede uma unica vez e inicie este projeto:

```bash
docker network create mobycontract-integracao
docker compose up --build -d
```

O Registry tambem fica disponivel apenas na maquina local em
`http://localhost:4000`; essa porta serve para diagnostico e colecoes Bruno,
nao para a interface publica do produto.

## Testes

```bash
docker compose run --rm testes
```

O PostgreSQL deste repositorio armazena exclusivamente as chaves de API do
Registry. Ele e independente do banco de dados da aplicacao de locacoes.
