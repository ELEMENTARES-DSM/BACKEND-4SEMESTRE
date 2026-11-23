#!/usr/bin/env bash
# ==============================================================================
# Script de Exemplo: Automação Diária de Download de CSV (Task 42.06 / US-42)
#
# Demonstração para munícipes / pesquisadores:
# 1. Realiza login na API pública com a conta do munícipe;
# 2. Obtém o token Bearer JWT;
# 3. Baixa as medições do dia anterior em formato CSV (GET /relatorios/medicoes);
# 4. Salva o arquivo local com a data de referência.
#
# Exemplo de agendamento diário no crontab (todo dia às 08:00):
# 0 8 * * * API_URL=http://localhost EMAIL=ana.silva@exemplo.com SENHA=... /caminho/para/scripts/exemplo-download-csv.sh >> /var/log/pulso_csv.log 2>&1
# ==============================================================================

set -euo pipefail

# Configurações de acesso
API_URL="${API_URL:-http://localhost}"
EMAIL="${EMAIL:-ana.silva@exemplo.com}"
SENHA="${SENHA:-SenhaForte@2026}"
MUNICIPIO="${MUNICIPIO:-}"
DIRETORIO_DESTINO="${DIRETORIO_DESTINO:-./downloads}"

DATA_ONTEM=$(node -e '
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  process.stdout.write(`${yyyy}-${mm}-${dd}`);
')

DATA_INICIO="${DATA_INICIO:-${DATA_ONTEM}}"
DATA_FIM="${DATA_FIM:-${DATA_ONTEM}}"
ARQUIVO_SAIDA="${DIRETORIO_DESTINO}/medicoes_${DATA_INICIO}_${DATA_FIM}.csv"
ARQUIVO_TEMP="${ARQUIVO_SAIDA}.tmp"

mkdir -p "${DIRETORIO_DESTINO}"

echo "[1/3] Realizando autenticação em ${API_URL}/auth/login para ${EMAIL}..."

LOGIN_PAYLOAD=$(node -e '
  process.stdout.write(JSON.stringify({ email: process.argv[1], senha: process.argv[2] }));
' "${EMAIL}" "${SENHA}")

LOGIN_RESPONSE=$(curl -sS -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "${LOGIN_PAYLOAD}")

TOKEN=$(node -e '
  try {
    const d = JSON.parse(process.argv[1]);
    process.stdout.write(typeof d.token === "string" ? d.token : "");
  } catch {}
' "${LOGIN_RESPONSE}")

if [ -z "${TOKEN}" ]; then
  echo "ERRO: Falha ao obter token de autenticação."
  echo "Resposta da API: ${LOGIN_RESPONSE}"
  exit 1
fi

echo "[2/3] Autenticação bem-sucedida. Token obtido."

QUERY_STRING=$(node -e '
  const params = new URLSearchParams({
    formato: "csv",
    inicio: process.argv[1],
    fim: process.argv[2],
  });
  if (process.argv[3]) {
    params.set("municipio", process.argv[3]);
  }
  process.stdout.write(params.toString());
' "${DATA_INICIO}" "${DATA_FIM}" "${MUNICIPIO}")

CSV_URL="${API_URL}/relatorios/medicoes?${QUERY_STRING}"
echo "[3/3] Baixando CSV em ${CSV_URL}..."

HTTP_META=$(curl -sS -w "\n%{http_code}\n%{content_type}" -o "${ARQUIVO_TEMP}" \
  -X GET "${CSV_URL}" \
  -H "Authorization: Bearer ${TOKEN}")

HTTP_STATUS=$(printf '%s\n' "${HTTP_META}" | sed -n '2p')
CONTENT_TYPE=$(printf '%s\n' "${HTTP_META}" | sed -n '3p')

if [ "${HTTP_STATUS}" -eq 200 ]; then
  if [[ "${CONTENT_TYPE}" != *"text/csv"* ]]; then
    echo "ERRO: Resposta inesperada (Content-Type: ${CONTENT_TYPE})."
    cat "${ARQUIVO_TEMP}"
    rm -f "${ARQUIVO_TEMP}"
    exit 1
  fi

  mv "${ARQUIVO_TEMP}" "${ARQUIVO_SAIDA}"
  echo "Sucesso! Arquivo CSV salvo em: ${ARQUIVO_SAIDA}"
  echo "Prévia das primeiras linhas:"
  head -n 5 "${ARQUIVO_SAIDA}"
elif [ "${HTTP_STATUS}" -eq 429 ]; then
  echo "AVISO: Cota semanal/mensal de requisições excedida (HTTP 429)."
  cat "${ARQUIVO_TEMP}"
  rm -f "${ARQUIVO_TEMP}"
  exit 1
else
  echo "ERRO: Falha ao baixar CSV. Código HTTP retornado: ${HTTP_STATUS}"
  cat "${ARQUIVO_TEMP}"
  rm -f "${ARQUIVO_TEMP}"
  exit 1
fi
