#!/usr/bin/env bash
# Gera a CA e o certificado TLS do broker, em mosquitto/certs/.
# Uso: bash scripts/mqtt/gerar-certificados.sh <host> [host-extra ...]
# Os hosts (DNS ou IP) entram no SAN; se o endereço mudar, gere de novo.

set -euo pipefail
# Evita que o Git Bash converta /CN=... em caminho do Windows
export MSYS_NO_PATHCONV=1

if [ $# -lt 1 ]; then
  echo "Uso: $0 <host-publico> [host-extra ...]" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")/../.." && pwd)/mosquitto/certs"
mkdir -p "$DIR"
cd "$DIR"

if [ -f ca.key ]; then
  echo "A CA já existe em $DIR. Apague os arquivos antes de regenerar" >&2
  echo "(isso invalida TODOS os certificados de estação já emitidos)." >&2
  exit 1
fi

SAN=""
for h in "$@"; do
  if [[ "$h" =~ ^[0-9.]+$ ]]; then
    SAN="${SAN:+$SAN,}IP:$h"
  else
    SAN="${SAN:+$SAN,}DNS:$h"
  fi
done

openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=Estacoes-Meteorologicas-CA" -out ca.crt

openssl genrsa -out server.key 2048
openssl req -new -key server.key -subj "/CN=$1" -out server.csr
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$SAN" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -sha256 -days 825 -extfile server.ext -out server.crt

rm -f server.csr server.ext ca.srl

# Chaves privadas só para o dono
chmod 600 ca.key server.key
chmod 644 ca.crt server.crt

echo ""
echo "CA e certificado do servidor gerados em mosquitto/certs/"
echo "   Arquivos que as estações precisam: ca.crt (copie junto com o certificado da estação)"
