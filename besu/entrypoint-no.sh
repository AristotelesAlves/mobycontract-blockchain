#!/usr/bin/env sh
set -eu

# Sobe um no Besu da rede QBFT. O compose injeta VALIDADOR (indice 1..N) e, para
# os que nao sao o primeiro, PARES com o enode do validador-1.
#
# Permissao:
#   PERMISSAO_CONTAS=true (padrao) -> so contas na allowlist enviam transacao
#   PERMISSAO_NOS=true              -> so os enodes da allowlist conectam (P2P)
#
# Sem PARES e sem descoberta, o no nao acha os outros: o validador-1 e o ponto
# de entrada e por isso nao recebe bootnode.

if [ -z "${VALIDADOR:-}" ]; then
  echo "VALIDADOR (indice 1..N) nao definido" >&2
  exit 1
fi

LISTA="$(ls -d /config/rede/keys/*/ | sort)"
CHAVE="$(printf '%s\n' "$LISTA" | sed -n "${VALIDADOR}p")"

if [ -z "$CHAVE" ]; then
  echo "nao ha chave para o validador ${VALIDADOR}; rode besu/gerar-rede.sh" >&2
  exit 1
fi

PARES_ARGS=""
if [ -n "${PARES:-}" ]; then
  for par in $(printf '%s' "$PARES" | tr ',' ' '); do
    PARES_ARGS="$PARES_ARGS --bootnodes=$par"
  done
fi

# O arquivo de permissoes vem montado read-only. Com o permissionamento ligado,
# o Besu tenta persistir (normalizar) a allowlist na subida e falha com
# ERROR_ALLOWLIST_PERSIST_FAIL se nao puder escrever. Copiamos para um caminho
# gravavel no container; o onboarding adiciona contas em tempo de execucao pela
# API PERM (`perm_addAccountsToAllowlist`) e tambem atualiza o arquivo do host,
# que e a fonte da verdade relida a cada subida.
CONFIG_PERM_RW="/tmp/permissions_config.toml"
if [ -f /config/rede/permissions_config.toml ]; then
  cp /config/rede/permissions_config.toml "$CONFIG_PERM_RW"
fi

PERMISSAO_ARGS=""
if [ "${PERMISSAO_CONTAS:-true}" = "true" ]; then
  PERMISSAO_ARGS="$PERMISSAO_ARGS --permissions-accounts-config-file=$CONFIG_PERM_RW --permissions-accounts-config-file-enabled"
fi
if [ "${PERMISSAO_NOS:-true}" = "true" ]; then
  PERMISSAO_ARGS="$PERMISSAO_ARGS --permissions-nodes-config-file=$CONFIG_PERM_RW --permissions-nodes-config-file-enabled"
fi

echo "iniciando validador ${VALIDADOR} com ${CHAVE}key"

exec besu \
  --genesis-file=/config/rede/genesis.json \
  --node-private-key-file="${CHAVE}key" \
  --data-path=/var/lib/besu \
  --p2p-host="${P2P_HOST:-0.0.0.0}" --p2p-port=30303 \
  --rpc-http-enabled --rpc-http-host=0.0.0.0 --rpc-http-port=8545 \
  --rpc-http-api=ETH,NET,WEB3,QBFT,TXPOOL,ADMIN,PERM \
  --host-allowlist='*' --rpc-http-cors-origins='*' \
  --min-gas-price=0 \
  --tx-pool-enable-balance-check=false \
  $PERMISSAO_ARGS \
  $PARES_ARGS
