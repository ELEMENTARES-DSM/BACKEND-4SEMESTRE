#!/usr/bin/env bash
# Pulso Urbano · confere se os papéis instalados nesta máquina estão saudáveis.
#
#   sudo ./verificar.sh            # todos os papéis desta máquina
#   sudo ./verificar.sh s2         # só um
#
# Sai com código 1 se alguma verificação falhar (dá para usar em cron).
DIR_DEPLOY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/comum.sh
. "$DIR_DEPLOY/lib/comum.sh"
# shellcheck source=lib/aplicacao.sh
. "$DIR_DEPLOY/lib/aplicacao.sh"
for _papel in s1 s2 s3 s4; do
  # shellcheck disable=SC1090
  . "$DIR_DEPLOY/lib/$_papel.sh"
done
trap - ERR
set +e

exigir_root
CONF=$ARQ_CONF_PADRAO
if [[ "${1:-}" == "-c" ]]; then CONF=$2; shift 2; fi
carregar_config "$CONF"

if [[ -n "${1:-}" ]]; then
  papeis=("$1")
else
  mapfile -t papeis < <(papeis_instalados)
  ((${#papeis[@]} > 0)) || erro "Nenhum papel instalado nesta máquina (rode ./instalar.sh primeiro)."
fi

for papel in "${papeis[@]}"; do
  [[ "$papel" =~ ^s[1-4]$ ]] || erro "Papel desconhecido: $papel"
  etapa "Verificando o ${papel^^} ($(hostname))"
  "verificar_$papel"
done
echo
if ((FALHAS == 0)); then ok "Tudo certo"; else aviso "$FALHAS verificação(ões) falharam"; exit 1; fi
