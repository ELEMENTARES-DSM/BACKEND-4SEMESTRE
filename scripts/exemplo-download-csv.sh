#!/usr/bin/env bash
# ==============================================================================
# Script de Exemplo: Automação Diária de Download de CSV (Task 42.06 / US-42)
#
# Demonstração para munícipes / pesquisadores:
# 1. Realiza login na API pública com a conta do munícipe;
# 2. Obtém o token Bearer JWT;
# 3. Baixa as medições das últimas 24h em formato CSV;
# 4. Salva o arquivo local com timestamp.
#
# Exemplo de agendamento diário no crontab (todo dia às 08:00):
# 0 8 * * * /caminho/para/scripts/exemplo-download-csv.sh >> /var/log/pulso_csv.log 2>&1
# ==============================================================================

set -euo pipefail

# Configurações de acesso
API_URL="${API_URL:-http://localhost:8080}"
EMAIL="${EMAIL:-ana.silva@exemplo.com}"
SENHA="${SENHA:-SenhaForte@2026}"
PERIODO="${PERIODO:-24h}"
DIRETORIO_DESTINO="${DIRETORIO_DESTINO:-./downloads}"

DATA_HOJE=$(date +"%Y-%m-%d")
ARQUIVO_SAIDA="${DIRETORIO_DESTINO}/leituras_${DATA_HOJE}.csv"

mkdir -p "${DIRETORIO_DESTINO}"

echo "[1/3] Realizando autenticação em ${API_URL}/auth/login para ${EMAIL}..."

LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"senha\":\"${SENHA}\"}")

# Extrai o token do retorno JSON
TOKEN=$(echo "${LOGIN_RESPONSE}" | grep -o '"token":"[^"]*' | cut -d'"' -f4 || true)

if [ -z "${TOKEN}" ]; then
  # Fallback caso a resposta venha em outro formato ou para ambiente sem jq
  TOKEN=$(node -e "try { const d = JSON.parse(process.argv[1]); process.stdout.write(d.token || ''); } catch {}" "${LOGIN_RESPONSE}")
fi

if [ -z "${TOKEN}" ]; then
  echo "ERRO: Falha ao obter token de autenticação."
  echo "Resposta da API: ${LOGIN_RESPONSE}"
  exit 1
fi

echo "[2/3] Autenticação bem-sucedida. Token obtido."
echo "[3/3] Baixando CSV do período (${PERIODO}) em ${API_URL}/analise/exportar/csv..."

HTTP_STATUS=$(curl -s -w "%{http_code}" -o "${ARQUIVO_SAIDA}" \
  -X GET "${API_URL}/analise/exportar/csv?periodo=${PERIODO}" \
  -H "Authorization: Bearer ${TOKEN}")

if [ "${HTTP_STATUS}" -eq 200 ]; then
  echo "Sucesso! Arquivo CSV salvo em: ${ARQUIVO_SAIDA}"
  echo "Linhas baixadas:"
  head -n 5 "${ARQUIVO_SAIDA}"
elif [ "${HTTP_STATUS}" -eq 429 ]; then
  echo "AVISO: Cota semanal/mensal de requisições excedida (HTTP 429)."
  cat "${ARQUIVO_SAIDA}"
  exit 1
else
  echo "ERRO: Falha ao baixar CSV. Código HTTP retornado: ${HTTP_STATUS}"
  cat "${ARQUIVO_SAIDA}"
  exit 1
fi
