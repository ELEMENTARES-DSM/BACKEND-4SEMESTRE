#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export POSTGRES_USER="${POSTGRES_USER:-ci}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-ci}"
export POSTGRES_DB="${POSTGRES_DB:-ci}"
export RABBITMQ_USER="${RABBITMQ_USER:-ci}"
export RABBITMQ_PASSWORD="${RABBITMQ_PASSWORD:-ci}"
export VALKEY_PASSWORD="${VALKEY_PASSWORD:-ci-descartavel}"
export JWT_SECRET="${JWT_SECRET:-ci-secret}"
export DOCKERHUB_USER="${DOCKERHUB_USER:-ci-local}"
export SMTP_HOST="${SMTP_HOST:-mailpit}"
export SMTP_PORT="${SMTP_PORT:-1025}"
export SMTP_SECURE="${SMTP_SECURE:-false}"
export SMTP_USER="${SMTP_USER:-}"
export SMTP_PASSWORD="${SMTP_PASSWORD:-}"
export SMTP_FROM="${SMTP_FROM:-ci@elementares.local}"

echo "==> Validando docker-compose.yml"
docker compose -f docker-compose.yml config --quiet

echo "==> Validando docker-compose.prod.yml e presença do serviço valkey"
docker compose -f docker-compose.prod.yml config --quiet
if ! docker compose -f docker-compose.prod.yml config --services | grep -qx "valkey"; then
  echo "ERRO: serviço 'valkey' ausente em docker-compose.prod.yml" >&2
  exit 1
fi

echo "==> Validando sintaxe de nginx.conf"
docker run --rm \
  --add-host swagger-ui:127.0.0.1 \
  --add-host auth-service:127.0.0.1 \
  --add-host gestao-usuarios:127.0.0.1 \
  --add-host alertas-notificacoes:127.0.0.1 \
  --add-host analise-dados:127.0.0.1 \
  --add-host gestao-estacoes:127.0.0.1 \
  --add-host ingestao-dados:127.0.0.1 \
  --add-host servico-relatorios:127.0.0.1 \
  --add-host servico-validacao:127.0.0.1 \
  -v "$(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:1.27-alpine nginx -t

BASE_REF="${BASE_REF:-}"
CHANGED_SERVICES=()

if [[ "$#" -gt 0 ]]; then
  CHANGED_SERVICES=("$@")
elif [[ -n "$BASE_REF" ]] && git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  mapfile -t CHANGED_SERVICES < <(
    git diff --name-only "$BASE_REF"...HEAD \
      | awk -F/ '$1 == "services" && NF >= 3 { print $2 }' \
      | sort -u
  )
fi

if [[ "${#CHANGED_SERVICES[@]}" -eq 0 ]]; then
  echo "==> Nenhum Dockerfile/serviço alterado detectado para docker build --no-cache."
else
  for svc in "${CHANGED_SERVICES[@]}"; do
    dockerfile="services/${svc}/Dockerfile"
    if [[ -f "$dockerfile" ]]; then
      echo "==> docker build --no-cache (sem push): ${svc}"
      docker build --no-cache -f "$dockerfile" -t "ci-check/${svc}:local" "services/${svc}"
    fi
  done
fi

echo "==> Validação de infraestrutura concluída com sucesso."
