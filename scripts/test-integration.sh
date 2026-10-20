#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Each invocation owns its containers, network, volume and random host ports.
project="estacoes-it-$(date +%s)-$$-${RANDOM}"
compose=(docker compose --env-file /dev/null -p "$project" -f docker-compose.test.yml)

cleanup() {
  result=$?
  trap - EXIT
  if (( result != 0 )); then
    "${compose[@]}" logs --no-color || true
  fi
  if ! "${compose[@]}" down --volumes --remove-orphans; then
    if (( result == 0 )); then result=1; fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${compose[@]}" build gestao-estacoes
"${compose[@]}" up -d --wait --wait-timeout 90 postgres
"${compose[@]}" run --rm --no-deps gestao-estacoes npm run migrate -- up
"${compose[@]}" up -d --wait --wait-timeout 90 gestao-estacoes

api_address=$("${compose[@]}" port gestao-estacoes 3000)
db_address=$("${compose[@]}" port postgres 5432)
export TEST_API_URL="http://${api_address}"
export TEST_DATABASE_URL="postgresql://integration:integration@${db_address}/estacoes_test"
export TEST_JWT_SECRET="integration-only-secret"

npm --prefix services/gestao-estacoes run test:integration
