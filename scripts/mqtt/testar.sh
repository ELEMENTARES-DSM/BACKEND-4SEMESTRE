#!/usr/bin/env bash
# Testa o broker Mosquitto nos cenários da US-29: conexão sem credencial e
# estação identificada pelo MAC no clientId e no tópico.
# Uso: bash scripts/mqtt/testar.sh <mac> [host]
#   mac:  12 hex minúsculos, sem separador (ex.: aabbccddeeff)
#   host: onde a porta 1883 está publicada (padrão: localhost)

set -uo pipefail
# Evita que o Git Bash converta caminhos e argumentos
export MSYS_NO_PATHCONV=1

MAC="${1:-}"
HOST="${2:-localhost}"
if ! [[ "$MAC" =~ ^[0-9a-f]{12}$ ]]; then
  echo "Uso: $0 <mac> [host]   (MAC com 12 hex minúsculos, ex.: aabbccddeeff)" >&2
  exit 1
fi

PORTA=1883
IMAGEM="eclipse-mosquitto:2.1.2-alpine"
ASSINATURA="pulso/estacoes/+/telemetria"
TOPICO="pulso/estacoes/$MAC/telemetria"
# Marca as mensagens desta execução: o que sobrou de execuções anteriores não conta
EXEC="$(date +%s)-$RANDOM"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1

# Os clientes rodam na imagem do broker, sem instalar nada no host. Dentro do
# contêiner "localhost" é ele mesmo, então vira o host da máquina.
ALVO="$HOST"
case "$HOST" in localhost|127.0.0.1) ALVO=host.docker.internal ;; esac
mq() {
  docker run --rm --add-host=host.docker.internal:host-gateway "$IMAGEM" \
    "$1" -h "$ALVO" -p "$PORTA" "${@:2}"
}

PASS=0
FAIL=0
PULO=0
ok()    { echo "  ok: $1"; PASS=$((PASS+1)); }
erro()  { echo "  FALHOU: $1"; FAIL=$((FAIL+1)); }
pulou() { echo "  pulado: $1"; PULO=$((PULO+1)); }

saude() { docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q mosquitto)" 2>/dev/null; }
esperar_saudavel() {
  for _ in $(seq 1 30); do
    [ "$(saude)" = "healthy" ] && return 0
    sleep 2
  done
  return 1
}

# Assinante sem credencial em pulso/estacoes/+/telemetria; a estação publica
# com clientId <id> e QoS 1. Imprime quantas mensagens desta execução chegaram.
publicar_e_receber() {
  local id="$1" topico="$2" marca="estacao-$EXEC-$1" saida sub
  saida="$(mktemp)"
  mq mosquitto_sub -q 1 -t "$ASSINATURA" -W 8 -v > "$saida" 2>/dev/null &
  sub=$!
  sleep 3
  mq mosquitto_pub -i "$id" -q 1 -t "$topico" -m "$marca" >/dev/null 2>&1
  wait "$sub"
  grep -c -- "$marca" "$saida"
  rm -f "$saida"
}

# Sessão persistente (clientId fixo, -c, QoS 1): conecta e sai, recebe 3
# publicações enquanto está fora e, ao reconectar, deve receber as 3.
# $1 = "reiniciar" para dar restart no broker antes de reconectar.
sessao_persistente() {
  local marca="sessao-$EXEC-$1" recebidas
  mq mosquitto_sub -i teste-ingestao -c -q 1 -t "$ASSINATURA" -E >/dev/null 2>&1 || { echo 0; return; }
  for i in 1 2 3; do
    mq mosquitto_pub -i "$MAC" -q 1 -t "$TOPICO" -m "$marca-$i" >/dev/null 2>&1
  done
  if [ "$1" = "reiniciar" ]; then
    docker compose restart mosquitto >/dev/null 2>&1
    esperar_saudavel || { echo 0; return; }
  fi
  recebidas="$(mq mosquitto_sub -i teste-ingestao -c -q 1 -t "$ASSINATURA" -W 5 -v 2>/dev/null | grep -c -- "$marca-")"
  # Conectar sem -c apaga a sessão de teste no broker
  mq mosquitto_sub -i teste-ingestao -t "$ASSINATURA" -E >/dev/null 2>&1
  echo "$recebidas"
}

echo "Testando o broker MQTT em $HOST:$PORTA com a estação $MAC (sem credencial)"
echo ""

echo "[1] Contêiner saudável"
STATUS="$(saude)"
if [ "$STATUS" = "healthy" ]; then ok "mosquitto healthy"; else erro "mosquitto status: ${STATUS:-desconhecido}"; fi
echo ""

echo "[2] Cenário 1: a estação $MAC publica sem credencial e o assinante recebe"
N="$(publicar_e_receber "$MAC" "$TOPICO")"
if [ "$N" = "1" ]; then ok "assinante recebeu a mensagem de $MAC"; else erro "assinante recebeu $N mensagem(ns), esperado 1"; fi
echo ""

NOVO="$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
echo "[3] Cenário 2: um MAC nunca usado ($NOVO) publica sem cadastro no broker"
N="$(publicar_e_receber "$NOVO" "pulso/estacoes/$NOVO/telemetria")"
if [ "$N" = "1" ]; then ok "assinante recebeu a mensagem de $NOVO"; else erro "assinante recebeu $N mensagem(ns), esperado 1"; fi
echo ""

echo "[4] Cenário 4: sessão persistente recebe as 3 mensagens publicadas enquanto estava fora"
N="$(sessao_persistente manter)"
if [ "$N" = "3" ]; then ok "recebeu 3 de 3 ao reconectar"; else erro "recebeu $N de 3 ao reconectar"; fi
echo ""

echo "[5] Cenário 5: o mesmo, com restart do mosquitto antes de reconectar"
N="$(sessao_persistente reiniciar)"
if [ "$N" = "3" ]; then ok "recebeu 3 de 3 depois do restart"; else erro "recebeu $N de 3 depois do restart"; fi
echo ""

echo "[6] ACL pelo MAC (critério [verificar], não é cenário)"
if grep -q '^acl_file' mosquitto/mosquitto.conf; then
  N="$(publicar_e_receber "$MAC" "pulso/estacoes/$NOVO/telemetria")"
  if [ "$N" = "0" ]; then ok "mensagem no tópico de $NOVO não foi entregue"; else erro "mensagem no tópico de $NOVO FOI entregue"; fi
else
  pulou "broker sem acl_file (ver mosquitto/LEIAME.md, 'Por que não há ACL')"
fi
echo ""

echo "Cenário 3 (tópico fora do padrão) é provado na ingestão (US da estação pelo MAC); Cenário 6 (fora da rede) é manual, na 29.05."
echo ""

echo "Resultado: $PASS passou(aram), $FAIL falhou(aram), $PULO pulado(s)"
[ "$FAIL" -eq 0 ]
