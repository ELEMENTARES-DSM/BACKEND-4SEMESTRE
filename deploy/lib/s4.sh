# shellcheck shell=bash
# S4 · Backup e monitoramento: cópias do banco, Prometheus, Alertmanager e
# Grafana. Sem internet; acesso pela VPN (REDE_ADMIN).

instalar_s4() {
  exigir_vars S1_IP S2_IP S3_IP S4_IP REDE_ADMIN POSTGRES_DB \
    POSTGRES_BACKUP_USER POSTGRES_BACKUP_PASSWORD VALKEY_S2_PORTA \
    BACKUP_DIR BACKUP_DIAS BACKUP_MESES BACKUP_HORARIO PROMETHEUS_RETENCAO \
    GRAFANA_USER GRAFANA_PASSWORD
  [[ "$BACKUP_HORARIO" =~ ^[0-2][0-9]:[0-5][0-9]$ ]] || erro "BACKUP_HORARIO no formato HH:MM (ex.: 02:30)"

  preparar_sistema
  firewall_base
  instalar_node_exporter # antes do backup: cria a pasta das métricas do backup
  instalar_backup
  instalar_prometheus
  instalar_grafana

  etapa "Firewall do S4"
  firewall_permitir "$REDE_ADMIN" 3000 "Grafana"
  firewall_permitir "$REDE_ADMIN" 9090 "Prometheus"
  firewall_permitir "$REDE_ADMIN" 9093 "Alertmanager"
}

instalar_backup() {
  etapa "Backup diário do banco (às $BACKUP_HORARIO, $BACKUP_DIAS diários + $BACKUP_MESES mensais)"
  apt_instalar postgresql-client
  garantir_pasta "$BACKUP_DIR" 0750
  install -d -m 0750 "$BACKUP_DIR/diario" "$BACKUP_DIR/mensal"
  escrever_env "$DIR_CONF/backup.env" root:root 0600 <<EOF
# Gerado pelo instalador do Pulso Urbano.
PGHOST=$S3_IP
PGPORT=5432
PGUSER=$POSTGRES_BACKUP_USER
PGPASSWORD=$POSTGRES_BACKUP_PASSWORD
PGDATABASE=$POSTGRES_DB
BACKUP_DIR=$BACKUP_DIR
BACKUP_DIAS=$BACKUP_DIAS
BACKUP_MESES=$BACKUP_MESES
EOF
  install -m 0750 "$DIR_MODELOS/backup/pulso-backup.sh" /usr/local/sbin/pulso-backup
  install -m 0644 "$DIR_MODELOS/backup/pulso-backup.service" /etc/systemd/system/pulso-backup.service
  renderizar "$DIR_MODELOS/backup/pulso-backup.timer" /etc/systemd/system/pulso-backup.timer BACKUP_HORARIO
  systemctl daemon-reload
  systemctl enable --now pulso-backup.timer > /dev/null 2>&1

  if esperar_porta "$S3_IP" 5432 5; then
    info "Fazendo o primeiro backup agora, para testar o acesso ao S3..."
    if systemctl start pulso-backup.service; then
      ok "Primeiro backup feito em $BACKUP_DIR/diario"
    else
      aviso "O primeiro backup falhou. Veja: journalctl -u pulso-backup -n 30 (o S3 já liberou o S4 na 5432?)"
    fi
  else
    aviso "O S3 ($S3_IP:5432) não respondeu: o backup fica agendado e roda quando o banco estiver no ar."
  fi
  ok "Próximo backup: $(systemctl show pulso-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || echo "às $BACKUP_HORARIO")"
}

instalar_prometheus() {
  etapa "Prometheus, Alertmanager e blackbox exporter (guarda $PROMETHEUS_RETENCAO de métricas)"
  apt_instalar prometheus prometheus-alertmanager prometheus-blackbox-exporter

  renderizar "$DIR_MODELOS/monitoramento/blackbox.yml" /etc/prometheus/blackbox.yml
  renderizar "$DIR_MODELOS/monitoramento/prometheus.yml" /etc/prometheus/prometheus.yml \
    S1_IP S2_IP S3_IP VALKEY_S2_PORTA
  renderizar "$DIR_MODELOS/monitoramento/pulso-alertas.yml" /etc/prometheus/pulso-alertas.yml
  escrever_alertmanager
  promtool check config /etc/prometheus/prometheus.yml > /dev/null \
    || erro "prometheus.yml inválido: rode 'promtool check config /etc/prometheus/prometheus.yml'"
  amtool check-config /etc/prometheus/alertmanager.yml > /dev/null \
    || erro "alertmanager.yml inválido: rode 'amtool check-config /etc/prometheus/alertmanager.yml'"

  cat > /etc/default/prometheus <<EOF
# Gerado pelo instalador do Pulso Urbano.
ARGS="--config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/var/lib/prometheus/metrics2/ --storage.tsdb.retention.time=$PROMETHEUS_RETENCAO --web.listen-address=0.0.0.0:9090"
EOF
  cat > /etc/default/prometheus-alertmanager <<'EOF'
# Gerado pelo instalador do Pulso Urbano. Um Alertmanager só: sem cluster.
ARGS="--config.file=/etc/prometheus/alertmanager.yml --storage.path=/var/lib/prometheus/alertmanager/ --cluster.listen-address= --web.listen-address=0.0.0.0:9093"
EOF
  cat > /etc/default/prometheus-blackbox-exporter <<'EOF'
# Gerado pelo instalador do Pulso Urbano. Só o Prometheus local usa.
ARGS="--config.file=/etc/prometheus/blackbox.yml --web.listen-address=127.0.0.1:9115"
EOF
  local unidade
  for unidade in prometheus-blackbox-exporter prometheus-alertmanager prometheus; do
    systemctl enable "$unidade" > /dev/null 2>&1
    systemctl restart "$unidade"
  done
  esperar_http http://127.0.0.1:9090/-/ready 60 || erro "O Prometheus não ficou pronto. Veja: journalctl -u prometheus -n 50"
  ok "Prometheus em http://$S4_IP:9090 e Alertmanager em http://$S4_IP:9093"
}

escrever_alertmanager() {
  local destino=/etc/prometheus/alertmanager.yml
  if [[ -n "${ALERTA_EMAIL_PARA:-}" && -n "${SMTP_HOST:-}" ]]; then
    local tls=true
    [[ "${SMTP_PORT:-587}" == "25" ]] && tls=false
    cat > "$destino" <<EOF
# Gerado pelo instalador do Pulso Urbano.
global:
  smtp_smarthost: '${SMTP_HOST}:${SMTP_PORT:-587}'
  smtp_from: '${SMTP_FROM}'
  smtp_auth_username: '${SMTP_USER:-}'
  smtp_auth_password: '${SMTP_PASSWORD:-}'
  smtp_require_tls: $tls

route:
  receiver: equipe
  group_by: [alertname, servidor]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: equipe
    email_configs:
      - to: '${ALERTA_EMAIL_PARA}'
        send_resolved: true
EOF
    ok "Alertas por e-mail para $ALERTA_EMAIL_PARA"
  else
    cat > "$destino" <<'EOF'
# Gerado pelo instalador do Pulso Urbano.
# Sem ALERTA_EMAIL_PARA/SMTP_HOST no pulso.conf: os alertas só aparecem na
# tela do Alertmanager (porta 9093) e no Grafana.
route:
  receiver: ninguem
  group_by: [alertname, servidor]
receivers:
  - name: ninguem
EOF
    aviso "ALERTA_EMAIL_PARA ou SMTP_HOST vazio: os alertas não serão enviados por e-mail."
  fi
  chown root:prometheus "$destino"
  chmod 0640 "$destino"
}

instalar_grafana() {
  etapa "Grafana (repositório oficial, versão OSS)"
  adicionar_repo grafana https://apt.grafana.com/gpg.key "https://apt.grafana.com stable main"
  apt_instalar grafana

  renderizar "$DIR_MODELOS/monitoramento/grafana-datasource.yml" /etc/grafana/provisioning/datasources/pulso.yml
  renderizar "$DIR_MODELOS/monitoramento/grafana-paineis.yml" /etc/grafana/provisioning/dashboards/pulso.yml
  chown root:grafana /etc/grafana/provisioning/datasources/pulso.yml /etc/grafana/provisioning/dashboards/pulso.yml
  garantir_pasta /var/lib/grafana/dashboards 0755 grafana:grafana
  garantir_pasta /var/lib/grafana/dashboards/pulso 0755 grafana:grafana
  local painel="$DIR_DEPLOY/../monitoramento/grafana/dashboards/pulso-urbano.json"
  if [[ -f "$painel" ]]; then
    install -m 0644 -o grafana -g grafana "$painel" /var/lib/grafana/dashboards/pulso/
    ok "Painel 'Saúde da Plataforma' copiado de monitoramento/grafana"
  else
    aviso "Não achei $painel: o Grafana sobe sem painel (rode o instalador de dentro da repo do backend)."
  fi

  bloco_gerenciado /etc/default/grafana-server "$(cat <<EOF
GF_SECURITY_ADMIN_USER=$GRAFANA_USER
GF_USERS_ALLOW_SIGN_UP=false
GF_ANALYTICS_REPORTING_ENABLED=false
GF_ANALYTICS_CHECK_FOR_UPDATES=false
GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false
GF_NEWS_NEWS_FEED_ENABLED=false
EOF
)"
  systemctl daemon-reload
  systemctl enable grafana-server > /dev/null 2>&1
  systemctl restart grafana-server
  esperar_http http://127.0.0.1:3000/api/health 90 || erro "O Grafana não subiu. Veja: journalctl -u grafana-server -n 50"
  if runuser -u grafana -- grafana-cli --homepath /usr/share/grafana --config /etc/grafana/grafana.ini \
       admin reset-admin-password "$GRAFANA_PASSWORD" > /dev/null 2>&1; then
    ok "Grafana em http://$S4_IP:3000 (usuário $GRAFANA_USER, senha do pulso.conf)"
  else
    aviso "Não consegui definir a senha do Grafana; o primeiro acesso é admin/admin e ele pede para trocar."
  fi
}

verificar_s4() {
  checar "Prometheus pronto" curl -fs -o /dev/null --max-time 5 http://127.0.0.1:9090/-/ready
  checar "Alertmanager pronto" curl -fs -o /dev/null --max-time 5 http://127.0.0.1:9093/-/ready
  checar "blackbox exporter ativo" systemctl is-active --quiet prometheus-blackbox-exporter
  checar "Grafana responde" curl -fs -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health
  checar "backup agendado (pulso-backup.timer)" systemctl is-active --quiet pulso-backup.timer
  checar "alcança o banco ($S3_IP:5432)" esperar_porta "$S3_IP" 5432 3

  local fora ultimo
  fora=$(curl -fs --max-time 5 http://127.0.0.1:9090/api/v1/targets 2>/dev/null \
    | jq -r '.data.activeTargets[] | select(.health != "up") | "\(.labels.job) \(.labels.instance) \(.labels.servico // "")"' 2>/dev/null || true)
  if [[ -z "$fora" ]]; then
    ok "todos os alvos do Prometheus estão no ar"
  else
    aviso "alvos fora do ar (normal se o servidor ainda não foi instalado):"
    printf '        %s\n' "$fora" >&2
  fi
  ultimo=$(find "$BACKUP_DIR/diario" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2- || true)
  if [[ -n "$ultimo" ]]; then
    ok "último backup: $(basename "$ultimo") ($(du -h "$ultimo" | cut -f1))"
  else
    aviso "nenhum backup ainda em $BACKUP_DIR/diario"
  fi
}
