#!/bin/sh
set -eu

CHAIN_ID="${CHAIN_ID_ESPERADO:-80002}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-/app/deployments}"
ARQUIVO="${DEPLOYMENTS_DIR}/${CHAIN_ID}.json"

if [ -z "${ENDERECO_CONTRATO:-}" ] && [ ! -f "$ARQUIVO" ]; then
  echo "ENDERECO_CONTRATO nao informado e $ARQUIVO nao existe: o contrato ainda nao foi implantado" >&2
  exit 1
fi

if [ -z "${ENDERECO_CONTRATO:-}" ]; then
  ENDERECO_CONTRATO="$(node -e "process.stdout.write(require('${ARQUIVO}').address)")"
  export ENDERECO_CONTRATO
  echo "endereco do contrato resolvido de ${ARQUIVO}: ${ENDERECO_CONTRATO}"
fi

if [ -z "${CHAVE_PRIVADA:-}" ]; then
  echo "CHAVE_PRIVADA ausente: o servico nao consegue assinar as ancoragens" >&2
  exit 1
fi

exec npx ts-node --transpile-only registry/src/main.ts