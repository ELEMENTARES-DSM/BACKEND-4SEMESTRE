#!/usr/bin/env bash
# Backup do banco do Pulso Urbano. Roda no S4, todo dia, pelo pulso-backup.timer.
# Gerado pelo instalador; a configuração fica em /etc/pulso-urbano/backup.env.
#
# - pg_dump do S3 em formato custom (comprimido, restaura com pg_restore)
# - confere que o arquivo abre (pg_restore --list) antes de aceitar
# - guarda BACKUP_DIAS cópias diárias e uma por mês durante BACKUP_MESES meses
# - publica a hora do último sucesso para o Prometheus (alerta BackupAtrasado)
set -Eeuo pipefail

# shellcheck disable=SC1091
. /etc/pulso-urbano/backup.env
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

DIARIO="$BACKUP_DIR/diario"
MENSAL="$BACKUP_DIR/mensal"
METRICAS_DIR=/var/lib/prometheus/node-exporter
inicio=$(date +%s)
arquivo="$DIARIO/${PGDATABASE}_$(date +%Y-%m-%d_%H%M).dump"

publicar() { # publicar <nome> <valor>
  [[ -d "$METRICAS_DIR" ]] || return 0
  local destino="$METRICAS_DIR/$1.prom"
  printf '%s\n' "$2" > "$destino.$$"
  chmod 0644 "$destino.$$"
  mv -f "$destino.$$" "$destino"
}

falhou() {
  rm -f "$arquivo.parcial"
  publicar pulso_backup_falha "pulso_backup_ultima_falha_timestamp_seconds $(date +%s)"
  echo "Backup FALHOU" >&2
}
trap falhou ERR

install -d -m 0750 "$DIARIO" "$MENSAL"

echo "Copiando $PGDATABASE de $PGHOST..."
pg_dump --format=custom --compress=6 --file="$arquivo.parcial"
pg_restore --list "$arquivo.parcial" > /dev/null
mv "$arquivo.parcial" "$arquivo"
(cd "$DIARIO" && sha256sum "$(basename "$arquivo")" > "$(basename "$arquivo").sha256")

# Uma cópia por mês: link para o primeiro backup do mês (não ocupa espaço a mais).
mes=$(date +%Y-%m)
if ! compgen -G "$MENSAL/${PGDATABASE}_${mes}*.dump" > /dev/null; then
  ln "$arquivo" "$MENSAL/$(basename "$arquivo")"
  cp "$arquivo.sha256" "$MENSAL/"
fi

# Retenção
find "$DIARIO" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.sha256' \) -mtime +"$BACKUP_DIAS" -delete
find "$MENSAL" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' | sort -rn \
  | tail -n +"$((BACKUP_MESES + 1))" | cut -d' ' -f2- | while read -r velho; do
      rm -f "$velho" "$velho.sha256"
    done

tamanho=$(stat -c %s "$arquivo")
duracao=$(($(date +%s) - inicio))
publicar pulso_backup "# HELP pulso_backup_ultimo_sucesso_timestamp_seconds Hora do último backup que deu certo.
# TYPE pulso_backup_ultimo_sucesso_timestamp_seconds gauge
pulso_backup_ultimo_sucesso_timestamp_seconds $(date +%s)
# HELP pulso_backup_tamanho_bytes Tamanho do último backup.
# TYPE pulso_backup_tamanho_bytes gauge
pulso_backup_tamanho_bytes $tamanho
# HELP pulso_backup_duracao_segundos Quanto o último backup levou.
# TYPE pulso_backup_duracao_segundos gauge
pulso_backup_duracao_segundos $duracao"
echo "OK: $arquivo ($((tamanho / 1024 / 1024)) MB em ${duracao}s)"
