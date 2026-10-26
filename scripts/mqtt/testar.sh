#!/usr/bin/env bash
# Testa o broker na porta 8883 com uma estação já cadastrada.
# Uso: bash scripts/mqtt/testar.sh <uuid> [host]
# A senha vem de senha.txt ou da variável MQTT_SENHA.

set -uo pipefail
# Evita que o Git Bash converta caminhos e argumentos como /CN=...
export MSYS_NO_PATHCONV=1

if [ $# -lt 1 ]; then
  echo "Uso: $0 <uuid-da-estacao> [host]" >&2
  exit 1
fi

UUID="$1"
HOST="${2:-localhost}"
PORTA=8883
OUTRA="00000000-0000-4000-8000-000000000000"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRED="$ROOT/mosquitto/credenciais/$UUID"
IMAGEM="eclipse-mosquitto:2.1.2-alpine"

if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

# openssl e docker do Windows não aceitam caminhos /c/...
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

SENHA="${MQTT_SENHA:-}"
if [ -z "$SENHA" ] && [ -f "$CRED/senha.txt" ]; then
  SENHA="$(cat "$CRED/senha.txt")"
fi
if [ -z "$SENHA" ]; then
  echo "Senha não encontrada. Passe MQTT_SENHA=... ou restaure $CRED/senha.txt" >&2
  exit 1
fi

PASS=0
FAIL=0
ok()   { echo "$1"; PASS=$((PASS+1)); }
erro() { echo "$1"; FAIL=$((FAIL+1)); }

# $1 = "com-cert" ou "sem-cert"; o resto são argumentos do mosquitto_pub
pub() {
  local modo="$1"; shift
  local certs=()
  if [ "$modo" = "com-cert" ]; then
    certs=(--cert /cred/client.crt --key /cred/client.key)
  fi
  docker run --rm -v "$(native "$CRED"):/cred:ro" \
    "$IMAGEM" mosquitto_pub -h "$HOST" -p $PORTA \
    --cafile /cred/ca.crt --insecure "${certs[@]}" "$@"
}

echo "Testando broker MQTT em $HOST:$PORTA para a estação '$UUID'"
echo ""

echo "[1] Container saudável"
STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q mosquitto)" 2>/dev/null)"
if [ "$STATUS" = "healthy" ]; then ok "mosquitto healthy"; else erro "mosquitto status: ${STATUS:-desconhecido}"; fi
echo ""

echo "[2] TLS com a CA da estação"
VERIF="$(echo | openssl s_client -connect "$HOST:$PORTA" -CAfile "$(native "$CRED/ca.crt")" \
  -servername "$HOST" 2>/dev/null | grep "Verify return code")"
if echo "$VERIF" | grep -q "Verify return code: 0"; then
  ok "handshake TLS válido"
else
  erro "handshake TLS falhou (${VERIF:-sem resposta}). O host está no SAN do certificado do servidor?"
fi
echo ""

echo "[3] Sem certificado de cliente, deve recusar"
pub sem-cert -u "$UUID" -P "$SENHA" -t "pulso/estacoes/$UUID/telemetria" -m "sem-cert" >/dev/null 2>&1
if [ $? -ne 0 ]; then ok "conexão sem certificado foi recusada"; else erro "conexão sem certificado foi ACEITA"; fi
echo ""

echo "[4] Senha errada, deve recusar"
pub com-cert -u "$UUID" -P "senha-errada-$RANDOM" -t "pulso/estacoes/$UUID/telemetria" -m "x" >/dev/null 2>&1
if [ $? -ne 0 ]; then ok "senha errada foi recusada"; else erro "senha errada foi ACEITA"; fi
echo ""

echo "[5] Estação publica no próprio tópico (QoS 1 e 2)"
for Q in 1 2; do
  pub com-cert -u "$UUID" -P "$SENHA" -q "$Q" -t "pulso/estacoes/$UUID/telemetria" -m "qos-$Q" >/dev/null 2>&1
  if [ $? -eq 0 ]; then ok "publicação QoS $Q aceita"; else erro "publicação QoS $Q falhou"; fi
done
echo ""

# O assinante precisa escutar antes da publicação; senão o teste não prova nada
echo "[6] Estação não publica em tópico de outra estação"
ALVO="pulso/estacoes/$OUTRA/telemetria"
ESCUTA="$(mktemp)"
docker compose exec -T mosquitto mosquitto_sub -h 127.0.0.1 -p 1883 \
  -u "${MOSQUITTO_USER:-ingestao-dados}" -P "${MOSQUITTO_PASSWORD:-}" \
  -t "pulso/estacoes/$OUTRA/telemetria" -C 1 -W 6 > "$ESCUTA" 2>/dev/null &
SUB=$!
sleep 3
pub com-cert -u "$UUID" -P "$SENHA" -q 1 -t "$ALVO" -m "invasao" >/dev/null 2>&1
wait "$SUB" 2>/dev/null
if [ -s "$ESCUTA" ]; then
  erro "mensagem em tópico alheio FOI entregue: $(cat "$ESCUTA")"
else
  ok "mensagem em tópico alheio não foi entregue"
fi
rm -f "$ESCUTA"
echo ""

echo "Resultado: $PASS passou(aram), $FAIL falhou(aram)"
[ "$FAIL" -eq 0 ]
