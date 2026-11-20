#!/usr/bin/env bash
# Teste ponta a ponta da US-39: coloca uma grandeza nova (Direção do Vento) no ar,
# do cadastro do sensor à medida gravada, passando pelo MQTT, pela DLQ e pelo
# reenvio. Roteiro e passos em tests/fluxo-ingestao/README.md.
#
# Uso (na raiz do backend, com o compose no ar e as migrations aplicadas):
#   scripts/teste-grandeza-nova.sh
#
# Usa a estação TF-10 da semente do teste de fluxo (município "Teste Fluxo") e
# deixa a estação como estava ao terminar. Só para o ambiente de teste: o reenvio
# da DLQ reprocessa TODAS as mensagens que estiverem lá.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Git Bash no Windows: não converter caminhos como "container:/app/arquivo".
export MSYS_NO_PATHCONV=1

erro() { echo "ERRO: $*" >&2; exit 2; }

[ -f .env ] || erro "crie o .env na raiz do backend (veja o .env.example)."
set -a
# shellcheck disable=SC1091
. ./.env
set +a

for servico in postgres rabbitmq mosquitto gestao-estacoes ingestao-dados servico-validacao nginx; do
  docker compose ps --status running --services | grep -qx "$servico" \
    || erro "o serviço $servico não está rodando. Suba com: docker compose up -d --build"
done

pasta=tests/fluxo-ingestao
[ -d "$pasta/node_modules" ] || npm --prefix "$pasta" ci --no-audit --no-fund --loglevel=error

# Estações TF-01 a TF-10 (a semente é a mesma do teste de fluxo e pode rodar de novo).
docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < "$pasta/semente-estacoes.sql" >/dev/null

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672"
export GATEWAY_URL="${GATEWAY_URL:-http://localhost}"
# O compose é chamado de dentro do pacote de testes: a pasta dele precisa ir explícita.
BACKEND_RAIZ="$(pwd -W 2>/dev/null || pwd)"
export BACKEND_RAIZ

npm --prefix "$pasta" run --silent grandeza
