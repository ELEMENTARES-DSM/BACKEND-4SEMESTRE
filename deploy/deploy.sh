#!/usr/bin/env bash
# =============================================================================
# Pulso Urbano · deploy de uma versão nova no S1 ou no S2 (já instalados)
#
#   sudo ./deploy.sh s1                          # REF_BACKEND/REF_FRONTEND do pulso.conf
#   sudo ./deploy.sh s1 --ref-backend 1.3.0 --ref-frontend 1.3.0
#   sudo ./deploy.sh s2 --ref-backend 1.3.0
#   sudo ./deploy.sh s1 --voltar                 # volta para a versão anterior
#
# Baixa o código, constrói, roda as migrations, troca a versão e reinicia os
# serviços. Se algum não responder ao /health, volta sozinho para a anterior.
# Ordem quando a versão mexe nos dois: S1 primeiro (as migrations rodam
# nele), depois S2. Opção: -c <arquivo> (padrão /etc/pulso-urbano/pulso.conf)
# =============================================================================
DIR_DEPLOY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/comum.sh
. "$DIR_DEPLOY/lib/comum.sh"
# shellcheck source=lib/aplicacao.sh
. "$DIR_DEPLOY/lib/aplicacao.sh"
# shellcheck source=lib/s1.sh
. "$DIR_DEPLOY/lib/s1.sh"
# shellcheck source=lib/s2.sh
. "$DIR_DEPLOY/lib/s2.sh"

uso() {
  awk 'NR > 2 && /^# =====/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "$0"
  exit "${1:-0}"
}

PAPEL=${1:-}
[[ "$PAPEL" == "s1" || "$PAPEL" == "s2" ]] || uso 1
shift
CONF=$ARQ_CONF_PADRAO
VOLTAR=""
NOVA_REF_BACKEND=""
NOVA_REF_FRONTEND=""
while (($#)); do
  case "$1" in
    --ref-backend) NOVA_REF_BACKEND=${2:?informe a branch, tag ou commit}; shift 2 ;;
    --ref-frontend) NOVA_REF_FRONTEND=${2:?informe a branch, tag ou commit}; shift 2 ;;
    --voltar) VOLTAR=1; shift ;;
    -c) CONF=${2:?informe o arquivo}; shift 2 ;;
    -h | --help) uso 0 ;;
    *) erro "Opção desconhecida: $1" ;;
  esac
done

exigir_root "$PAPEL"
conferir_ubuntu
carregar_config "$CONF"
if [[ -n "$NOVA_REF_BACKEND" ]]; then REF_BACKEND=$NOVA_REF_BACKEND; fi
if [[ -n "$NOVA_REF_FRONTEND" ]]; then REF_FRONTEND=$NOVA_REF_FRONTEND; fi
papeis_instalados | grep -qx "$PAPEL" \
  || erro "O ${PAPEL^^} não foi instalado nesta máquina. Rode antes: sudo ./instalar.sh $PAPEL"
iniciar_log "deploy-$PAPEL"

voltar_versao() {
  local servicos anterior site_ativo site_anterior
  read -r -a servicos <<< "$(servicos_do_papel "$PAPEL")"
  anterior=$(release_anterior "$PAPEL")
  [[ -n "$anterior" ]] || erro "Não há versão anterior guardada em $RELEASES."
  etapa "Voltando o ${PAPEL^^} para $(basename "$anterior")"
  ativar_release "$anterior" "${servicos[@]}"
  if [[ "$PAPEL" == "s1" ]]; then
    site_ativo=$(readlink -f "$WEB/atual" || true)
    site_anterior=$(find "$WEB/releases" -mindepth 1 -maxdepth 1 -type d | sort \
      | awk -v ativa="$site_ativo" '$0 == ativa { print anterior; exit } { anterior = $0 }')
    if [[ -n "$site_anterior" ]]; then
      ativar_frontend "$site_anterior"
      ok "site: $(basename "$site_anterior")"
    fi
  fi
  reiniciar_servicos "${servicos[@]}" || erro "A versão anterior também não subiu. Veja: journalctl -u 'pulso@*' -n 100"
  aviso "As migrations não voltam: se a versão nova mudou o banco, confira antes de usar."
}

if [[ -n "$VOLTAR" ]]; then
  voltar_versao
else
  descricao="backend $REF_BACKEND"
  if [[ "$PAPEL" == "s1" ]]; then descricao+=", frontend $REF_FRONTEND"; fi
  etapa "Deploy no ${PAPEL^^}: $descricao"
  implantar_aplicacao "$PAPEL"
fi
if [[ "$PAPEL" == "s1" ]]; then recarregar_nginx; fi

etapa "Verificação do ${PAPEL^^}"
rodar_verificacao "$PAPEL"
if [[ -n "$NOVA_REF_BACKEND$NOVA_REF_FRONTEND" ]]; then
  aviso "Lembre de pôr a mesma versão em REF_BACKEND/REF_FRONTEND no pulso.conf dos 4 servidores."
fi
if ((FALHAS == 0)); then ok "Deploy concluído. Log em $ARQ_LOG"; else aviso "$FALHAS verificação(ões) falharam. Log em $ARQ_LOG"; fi
