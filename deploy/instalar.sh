#!/usr/bin/env bash
# =============================================================================
# Pulso Urbano · instalação de um servidor (Ubuntu Server 24.04)
#
#   sudo ./instalar.sh gerar-config > pulso.conf     # uma vez, numa máquina qualquer
#   sudo ./instalar.sh s3                             # banco
#   sudo ./instalar.sh s1                             # aplicação
#   sudo ./instalar.sh s2                             # recepção
#   sudo ./instalar.sh s4                             # backup e monitoramento
#
# Cada papel instala sozinho, numa máquina física ou VM. Pode rodar de novo
# a qualquer hora: o que já está certo fica como está.
# Opção: -c <arquivo>  configuração (padrão /etc/pulso-urbano/pulso.conf)
# =============================================================================
DIR_DEPLOY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/comum.sh
. "$DIR_DEPLOY/lib/comum.sh"
# shellcheck source=lib/aplicacao.sh
. "$DIR_DEPLOY/lib/aplicacao.sh"
for _papel in s1 s2 s3 s4; do
  # shellcheck disable=SC1090
  . "$DIR_DEPLOY/lib/$_papel.sh"
done

uso() {
  awk 'NR > 2 && /^# =====/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "$0"
  exit "${1:-0}"
}

PAPEL=${1:-}
[[ -n "$PAPEL" ]] || uso 1
shift
CONF=$ARQ_CONF_PADRAO
while getopts ":c:h" opcao; do
  case $opcao in
    c) CONF=$OPTARG ;;
    h) uso 0 ;;
    *) uso 1 ;;
  esac
done

case "$PAPEL" in
  gerar-config)
    gerar_config
    exit 0
    ;;
  s1 | s2 | s3 | s4) ;;
  -h | --help | ajuda) uso 0 ;;
  *) erro "Papel desconhecido: $PAPEL (use s1, s2, s3, s4 ou gerar-config)" ;;
esac

exigir_root "$PAPEL"
conferir_ubuntu
carregar_config "$CONF"
iniciar_log "instalar-$PAPEL"

declare -A NOME=([s1]="S1 · Aplicação" [s2]="S2 · Recepção" [s3]="S3 · Banco" [s4]="S4 · Backup e monitoramento")
etapa "Instalando ${NOME[$PAPEL]} ($(hostname), $(date '+%d/%m/%Y %H:%M'))"
"instalar_$PAPEL"
registrar_papel "$PAPEL"

etapa "Verificação do ${PAPEL^^}"
rodar_verificacao "$PAPEL"
echo
if ((FALHAS == 0)); then
  ok "${NOME[$PAPEL]} instalado. Log em $ARQ_LOG"
else
  aviso "${NOME[$PAPEL]} instalado com $FALHAS verificação(ões) falhando (veja acima). Log em $ARQ_LOG"
  aviso "Algumas dependem de outro servidor ainda não instalado. Depois rode: sudo ./verificar.sh"
fi
