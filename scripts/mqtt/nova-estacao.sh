#!/usr/bin/env bash
# Cria certificado de cliente e usuário/senha MQTT para uma estação.
# Uso: bash scripts/mqtt/nova-estacao.sh <uuid-da-estacao>
# O UUID é o estacao_id cadastrado no gestao-estacoes. Ele vira o usuário MQTT.

set -euo pipefail
# Evita que o Git Bash converta /CN=... em caminho do Windows
export MSYS_NO_PATHCONV=1

if [ $# -ne 1 ]; then
  echo "Uso: $0 <uuid-da-estacao>" >&2
  exit 1
fi

UUID="$1"
# ingestao-dados é o único usuário que não é UUID: é um serviço, não uma estação
if [ "$UUID" != "ingestao-dados" ] && [ "$UUID" != "simulador" ] && ! [[ "$UUID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "UUID inválido: use o estacao_id no formato 8-4-4-4-12 em minúsculas." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOSQ="$ROOT/mosquitto"
CERTS="$MOSQ/certs"
OUT="$MOSQ/credenciais/$UUID"

if [ ! -f "$CERTS/ca.key" ]; then
  echo "CA não encontrada. Rode primeiro: bash scripts/mqtt/gerar-certificados.sh <host>" >&2
  exit 1
fi

if [ -e "$OUT" ]; then
  echo "Já existem credenciais para '$UUID' em $OUT." >&2
  echo "Remova a pasta antes de recriar (e remova o usuário do passwd)." >&2
  exit 1
fi

if [ -f "$MOSQ/passwd" ] && grep -q "^$UUID:" "$MOSQ/passwd"; then
  echo "O usuário '$UUID' já existe em mosquitto/passwd." >&2
  exit 1
fi

mkdir -p "$OUT"

# openssl do Windows não aceita caminhos /c/... do Git Bash
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
OUT_N="$(native "$OUT")"
CERTS_N="$(native "$CERTS")"

openssl genrsa -out "$OUT_N/client.key" 2048
openssl req -new -key "$OUT_N/client.key" -subj "/CN=$UUID" -out "$OUT_N/client.csr"
printf "extendedKeyUsage=clientAuth\n" > "$OUT/client.ext"
openssl x509 -req -in "$OUT_N/client.csr" -CA "$CERTS_N/ca.crt" -CAkey "$CERTS_N/ca.key" \
  -CAcreateserial -sha256 -days 825 -extfile "$OUT_N/client.ext" -out "$OUT_N/client.crt"
cp "$CERTS/ca.crt" "$OUT/ca.crt"
rm -f "$OUT/client.csr" "$OUT/client.ext" "$CERTS/ca.srl"
chmod 600 "$OUT/client.key"

SENHA="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"
touch "$MOSQ/passwd"

# mosquitto_passwd roda na imagem oficial; o Docker precisa do caminho C:\...
MOSQ_DOCKER="$MOSQ"
if command -v cygpath >/dev/null 2>&1; then MOSQ_DOCKER="$(cygpath -w "$MOSQ")"; fi

docker run --rm -v "$MOSQ_DOCKER:/work" eclipse-mosquitto:2.1.2-alpine \
  mosquitto_passwd -b /work/passwd "$UUID" "$SENHA"

printf "%s" "$SENHA" > "$OUT/senha.txt"
chmod 600 "$OUT/senha.txt"

echo ""
echo "Credenciais criadas para '$UUID'"
echo "   Pasta: mosquitto/credenciais/$UUID/"
echo "   Usuário MQTT: $UUID"
echo "   Tópico permitido: pulso/estacoes/$UUID/telemetria"
echo ""
echo "   Entregue à estação: ca.crt, client.crt, client.key e a senha em senha.txt"
echo "   Depois de entregue, apague senha.txt. O certificado NÃO deve ser compartilhado."
