#!/usr/bin/env bash
# Teste contínuo do fluxo de ingestão (US-21) no Docker Compose, sem nuvem.
#
# Envia um lote pelo simulador (modo lote), espera o fluxo terminar e confere o
# balanço: enviadas = gravadas + rejeitadas + ignoradas + DLQ. Diferença
# diferente de zero encerra com erro.
#
# Uso (na raiz do backend, com o compose no ar e as migrations aplicadas):
#   scripts/teste-fluxo-ingestao.sh                      um lote de 1.000 medidas
#   scripts/teste-fluxo-ingestao.sh --continuo           lotes seguidos até Ctrl+C
#   scripts/teste-fluxo-ingestao.sh --continuo --lotes 5
#   scripts/teste-fluxo-ingestao.sh --queda-banco 20     PostgreSQL fora por 20 s no lote
#   scripts/teste-fluxo-ingestao.sh --medidas 5000 --tempo-limite 300
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# Git Bash no Windows: não converter caminhos como "container:/app/arquivo".
export MSYS_NO_PATHCONV=1

medidas=1000
continuo=0
lotes=0
queda_banco=0
tempo_limite=120
inicio=""

uso() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --medidas) medidas="${2:?}"; shift 2 ;;
    --continuo) continuo=1; shift ;;
    --lotes) lotes="${2:?}"; shift 2 ;;
    --queda-banco) queda_banco="${2:?}"; shift 2 ;;
    --tempo-limite) tempo_limite="${2:?}"; shift 2 ;;
    --inicio) inicio="${2:?}"; shift 2 ;;
    -h|--ajuda) uso; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; uso >&2; exit 2 ;;
  esac
done

erro() { echo "ERRO: $*" >&2; exit 2; }

[ -f .env ] || erro "crie o .env na raiz do backend (veja o .env.example)."
set -a
# shellcheck disable=SC1091
. ./.env
set +a

for servico in postgres rabbitmq mosquitto ingestao-dados servico-validacao; do
  docker compose ps --status running --services | grep -qx "$servico" \
    || erro "o serviço $servico não está rodando. Suba com: docker compose up -d --build"
done

pasta=tests/fluxo-ingestao
saida="$pasta/saida"
mkdir -p "$saida"
[ -d "$pasta/node_modules" ] || npm --prefix "$pasta" ci --no-audit --no-fund --loglevel=error

# Estações TF-01 a TF-10, só do teste (município "Teste Fluxo").
docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < "$pasta/semente-estacoes.sql" >/dev/null
estacoes=$(seq -f "f1000000-0000-4000-8000-00000000%04g" 1 10 | paste -sd, -)

docker compose build -q simulador-estacoes

export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export RABBITMQ_URL="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@localhost:5672"

esperar_banco() {
  local limite=$((SECONDS + 60))
  until docker compose exec -T postgres pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null; do
    [ "$SECONDS" -lt "$limite" ] || erro "o PostgreSQL não voltou em 60 s."
    sleep 1
  done
}

container=""
limpar() {
  [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1 || true
  if [ "$queda_banco" -gt 0 ]; then
    docker compose start postgres >/dev/null 2>&1 || true
  fi
}
trap limpar EXIT

# Cada lote usa horários até alguns segundos no futuro. Sem --inicio, começa
# depois do último horário das estações de teste no staging: estação e horário
# repetidos seriam descartados como duplicata pela ingestão.
if [ -z "$inicio" ]; then
  ultimo=$(docker compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
    "SELECT COALESCE(MAX(unixtime), 0) FROM staging_telemetria WHERE estacao_uuid IN (SELECT id FROM estacoes WHERE municipio = 'Teste Fluxo')")
  agora=$(date +%s)
  inicio=$(( ultimo >= agora ? ultimo + 1 : agora ))
fi
n=0
while :; do
  n=$((n + 1))
  manifesto="$saida/lote-$(date +%Y%m%d-%H%M%S)-$n.jsonl"
  container="fluxo-lote-$$-$n"
  echo "== Lote $n: $medidas medidas a partir do unixtime $inicio"

  if [ "$queda_banco" -gt 0 ]; then
    echo "   PostgreSQL fora do ar por $queda_banco s durante o lote"
    docker compose stop postgres >/dev/null
  fi

  docker compose run -T --no-deps --name "$container" \
    -e LOTE_ESTACOES="$estacoes" \
    -e LOTE_MEDIDAS="$medidas" \
    -e LOTE_INICIO_UNIX="$inicio" \
    -e LOTE_MANIFESTO=/app/manifesto.jsonl \
    simulador-estacoes node dist/lote.js
  docker cp "$container:/app/manifesto.jsonl" "$manifesto" >/dev/null
  docker rm "$container" >/dev/null
  container=""

  if [ "$queda_banco" -gt 0 ]; then
    sleep "$queda_banco"
    docker compose start postgres >/dev/null
    esperar_banco
    echo "   PostgreSQL de volta"
  fi

  if ! npm --prefix "$pasta" run --silent balanco -- --manifesto "$manifesto" --tempo-limite "$tempo_limite"; then
    echo "== Lote $n NÃO fechou. Manifesto: $manifesto" >&2
    exit 1
  fi

  if [ "$continuo" = 0 ] || { [ "$lotes" -gt 0 ] && [ "$n" -ge "$lotes" ]; }; then
    break
  fi
  # O próximo lote começa depois do último horário deste: sem duplicata falsa.
  inicio=$(node -e "const l=require('fs').readFileSync(process.argv[1],'utf8').trim().split(/\r?\n/);console.log(Math.max(...l.map(x=>JSON.parse(x).unixtime))+1)" "$manifesto")
done

echo "== $n lote(s) com balanço fechado."
