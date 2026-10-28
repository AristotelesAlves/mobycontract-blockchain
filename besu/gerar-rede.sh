#!/usr/bin/env sh
set -eu

# Gera a rede privada QBFT: genesis.json + uma chave por validador, e em seguida
# as permissoes (contas e nos). Idempotente: se a genesis ja existe, nao regera.
#
#   sh besu/gerar-rede.sh
#   docker compose -f besu/docker-compose.yml up -d
#
# Requer o daemon do Docker no ar. NAO versionar besu/rede nem besu/.env.

DIR="$(cd "$(dirname "$0")" && pwd)"
REDE="$DIR/rede"
IMAGEM="${BESU_IMAGEM:-hyperledger/besu:latest}"

if [ -f "$REDE/genesis.json" ]; then
  echo "rede ja gerada em $REDE (apague a pasta para regerar)"
  exit 0
fi

# O Besu recusa um --to que ja exista, e um bind mount de Docker sempre existe.
# Por isso montamos o diretorio besu/ inteiro e deixamos o Besu criar rede/.
#
# --entrypoint: contornamos o besu-entry.sh da imagem, que roda o comando duas
# vezes quando o container e root (uma vez para ajustar permissoes) - na segunda
# o diretorio de saida ja existe e a geracao falha.
rm -rf "$REDE"

echo "gerando genesis e chaves dos validadores com $IMAGEM ..."
docker run --rm \
  --entrypoint /opt/besu/bin/besu \
  -v "$DIR:/saida" \
  "$IMAGEM" \
  operator generate-blockchain-config \
  --config-file=/saida/qbftConfigFile.json \
  --to=/saida/rede \
  --private-key-file-name=key

node "$DIR/gerar-permissoes.js" "$REDE"

echo "rede gerada em $REDE"
echo "proximo passo: docker compose -f besu/docker-compose.yml up -d"
