# shellcheck shell=bash
# S3 · Banco: PostgreSQL. Sem internet; só S1, S2 (aplicação) e S4 (backup)
# chegam na 5432.

instalar_s3() {
  exigir_vars S1_IP S2_IP S3_IP S4_IP REDE_ADMIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD \
    POSTGRES_BACKUP_USER POSTGRES_BACKUP_PASSWORD POSTGRES_MONITOR_PASSWORD PG_MAX_CONNECTIONS
  exigir_senhas_simples POSTGRES_PASSWORD POSTGRES_BACKUP_PASSWORD POSTGRES_MONITOR_PASSWORD
  local nome
  for nome in POSTGRES_DB POSTGRES_USER POSTGRES_BACKUP_USER; do
    [[ "${!nome}" =~ ^[a-z_][a-z0-9_]*$ ]] || erro "$nome: use letras minúsculas, números e _"
  done

  preparar_sistema
  firewall_base
  instalar_postgresql
  criar_banco
  instalar_postgres_exporter

  etapa "Firewall do S3"
  firewall_permitir "$S1_IP" 5432 "serviços do S1"
  firewall_permitir "$S2_IP" 5432 "serviços do S2"
  firewall_permitir "$S4_IP" 5432 "backup do S4"
  instalar_node_exporter
}

versao_postgres() {
  find /etc/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort -V | tail -n 1
}

instalar_postgresql() {
  etapa "PostgreSQL"
  apt_instalar postgresql
  PG_VERSAO=$(versao_postgres)
  [[ -n "$PG_VERSAO" ]] || erro "Não achei o cluster do PostgreSQL em /etc/postgresql"
  local dir="/etc/postgresql/$PG_VERSAO/main" memoria_mb
  memoria_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  : "${PG_SHARED_BUFFERS:=$((memoria_mb / 4))MB}"
  : "${PG_EFFECTIVE_CACHE_SIZE:=$((memoria_mb * 3 / 4))MB}"
  if [[ "$S3_IP" == "127.0.0.1" ]]; then PG_LISTEN="localhost"; else PG_LISTEN="localhost,$S3_IP"; fi

  renderizar "$DIR_MODELOS/postgresql-pulso.conf" "$dir/conf.d/pulso.conf" \
    PG_LISTEN PG_MAX_CONNECTIONS PG_SHARED_BUFFERS PG_EFFECTIVE_CACHE_SIZE
  chown postgres:postgres "$dir/conf.d/pulso.conf"

  # Quem pode conectar, de onde (o resto continua como o pacote deixou).
  bloco_gerenciado "$dir/pg_hba.conf" "$(cat <<EOF
host  $POSTGRES_DB  $POSTGRES_USER         $S1_IP/32  scram-sha-256
host  $POSTGRES_DB  $POSTGRES_USER         $S2_IP/32  scram-sha-256
host  $POSTGRES_DB  $POSTGRES_BACKUP_USER  $S4_IP/32  scram-sha-256
EOF
)"
  systemctl enable postgresql > /dev/null 2>&1
  systemctl restart "postgresql@$PG_VERSAO-main"
  local i
  for ((i = 0; i < 30; i++)); do
    pg_isready -q -h 127.0.0.1 && break
    sleep 1
  done
  pg_isready -q -h 127.0.0.1 || erro "O PostgreSQL não subiu. Veja: journalctl -u postgresql@$PG_VERSAO-main -n 50"
  ok "PostgreSQL $PG_VERSAO escutando em $PG_LISTEN (shared_buffers $PG_SHARED_BUFFERS, jit off)"
}

criar_banco() {
  etapa "Banco $POSTGRES_DB e usuários"
  # As senhas vão como variáveis do psql (:'senha'), sem passar pela linha de comando do shell.
  runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 \
    -v banco="$POSTGRES_DB" -v usuario="$POSTGRES_USER" -v senha="$POSTGRES_PASSWORD" \
    -v backup="$POSTGRES_BACKUP_USER" -v senha_backup="$POSTGRES_BACKUP_PASSWORD" \
    -v senha_monitor="$POSTGRES_MONITOR_PASSWORD" <<'SQL'
-- Dono do banco: os serviços e as migrations
SELECT format('CREATE ROLE %I LOGIN', :'usuario')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'usuario') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'usuario', :'senha') \gexec
SELECT format('CREATE DATABASE %I OWNER %I ENCODING ''UTF8'' TEMPLATE template0', :'banco', :'usuario')
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'banco') \gexec

-- Backup (S4): só lê
SELECT format('CREATE ROLE %I LOGIN', :'backup')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'backup') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'backup', :'senha_backup') \gexec
SELECT format('GRANT pg_read_all_data TO %I', :'backup') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'banco', :'backup') \gexec

-- Coletor de métricas (postgres exporter, na própria máquina)
SELECT 'CREATE ROLE pulso_monitor LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pulso_monitor') \gexec
SELECT format('ALTER ROLE pulso_monitor WITH LOGIN PASSWORD %L', :'senha_monitor') \gexec
GRANT pg_monitor TO pulso_monitor;

-- As migrations usam gen_random_uuid() e pgcrypto
\c :banco
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
  ok "banco $POSTGRES_DB (dono $POSTGRES_USER), backup $POSTGRES_BACKUP_USER (só leitura), monitor pulso_monitor"
  info "As tabelas são criadas pelas migrations, quando o S1 ou o S2 forem instalados."
}

instalar_postgres_exporter() {
  etapa "Coletor de métricas do PostgreSQL (porta 9187)"
  apt_instalar prometheus-postgres-exporter
  escrever_env /etc/default/prometheus-postgres-exporter root:root 0600 <<EOF
# Gerado pelo instalador do Pulso Urbano.
DATA_SOURCE_NAME='postgresql://pulso_monitor:${POSTGRES_MONITOR_PASSWORD}@127.0.0.1:5432/postgres?sslmode=disable'
ARGS=""
EOF
  systemctl enable prometheus-postgres-exporter > /dev/null 2>&1
  systemctl restart prometheus-postgres-exporter
  firewall_permitir "$S4_IP" 9187 "métricas do PostgreSQL para o S4"
  ok "postgres exporter no ar"
}

verificar_s3() {
  PG_VERSAO=$(versao_postgres)
  checar "PostgreSQL ativo" systemctl is-active --quiet "postgresql@$PG_VERSAO-main"
  checar "aceita conexões" pg_isready -q -h 127.0.0.1
  checar "banco $POSTGRES_DB existe" bash -c \
    "runuser -u postgres -- psql -XtAc \"SELECT 1 FROM pg_database WHERE datname = '$POSTGRES_DB'\" | grep -q 1"
  checar "jit desligado" bash -c "runuser -u postgres -- psql -XtAc 'SHOW jit' | grep -qx off"
  local tabelas
  tabelas=$(runuser -u postgres -- psql -XtA -d "$POSTGRES_DB" \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null || echo 0)
  if [[ "$tabelas" -gt 0 ]]; then
    ok "$tabelas tabelas no banco (migrations já rodaram)"
  else
    aviso "Banco ainda sem tabelas: as migrations rodam quando o S1 ou o S2 for instalado."
  fi
  checar "postgres exporter ativo" systemctl is-active --quiet prometheus-postgres-exporter
  checar "node exporter ativo" systemctl is-active --quiet prometheus-node-exporter
}
