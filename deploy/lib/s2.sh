# shellcheck shell=bash
# S2 · Recepção: Mosquitto, ingestao-dados, RabbitMQ, servico-validacao,
# alertas-notificacoes e Valkey. Sem internet: as estações chegam pela rede
# da Prefeitura na porta MQTT 1883.

instalar_s2() {
  exigir_vars S1_IP S2_IP S3_IP S4_IP REDE_ADMIN REDE_ESTACOES MQTT_BIND MQTT_QOS \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD JWT_SECRET \
    RABBITMQ_USER RABBITMQ_PASSWORD RABBITMQ_LIMITE_MEMORIA \
    VALKEY_S2_SENHA VALKEY_S2_PORTA VALKEY_S2_MAXMEMORY \
    REPO_BACKEND REF_BACKEND NODE_MAJOR
  exigir_senhas_simples POSTGRES_PASSWORD RABBITMQ_PASSWORD VALKEY_S2_SENHA
  [[ "$RABBITMQ_USER" =~ ^[A-Za-z0-9_]+$ ]] || erro "RABBITMQ_USER: use só letras, números e _"

  preparar_sistema
  firewall_base
  instalar_mosquitto
  instalar_rabbitmq
  # Escuta também no IP interno: o gestao-estacoes do S1 lê o staging daqui.
  instalar_valkey s2 "$VALKEY_S2_PORTA" "$VALKEY_S2_SENHA" "$VALKEY_S2_MAXMEMORY" "$(enderecos_escuta "$S2_IP")"
  instalar_node
  criar_usuario_app
  implantar_aplicacao s2

  etapa "Firewall do S2"
  firewall_permitir "$REDE_ESTACOES" 1883 "MQTT das estações"
  local porta
  for porta in 3002 3005 3007; do
    firewall_permitir "$S1_IP" "$porta" "nginx do S1"
    firewall_permitir "$S4_IP" "$porta" "verificação de saúde do S4"
  done
  firewall_permitir "$S1_IP" "$VALKEY_S2_PORTA" "gestao-estacoes do S1 lê o staging"
  firewall_permitir "$S4_IP" "$VALKEY_S2_PORTA" "verificação de porta do S4"
  firewall_permitir "$S4_IP" 1883 "verificação de porta do S4"
  firewall_permitir "$S4_IP" 15692 "métricas do RabbitMQ para o S4"
  instalar_node_exporter
  instalar_redis_exporter "$VALKEY_S2_PORTA" "$VALKEY_S2_SENHA"
}

instalar_mosquitto() {
  etapa "Mosquitto (MQTT 1883, sem senha: só a rede das estações alcança)"
  apt_instalar mosquitto mosquitto-clients
  renderizar "$DIR_MODELOS/mosquitto.conf" /etc/mosquitto/mosquitto.conf MQTT_BIND
  systemctl enable mosquitto > /dev/null 2>&1
  systemctl restart mosquitto
  esperar_porta 127.0.0.1 1883 30 || erro "O Mosquitto não abriu a 1883. Veja: journalctl -u mosquitto -n 50"
  ok "Mosquitto escutando em $MQTT_BIND:1883"
}

instalar_rabbitmq() {
  etapa "RabbitMQ (fila entre ingestão, validação e alertas; só na própria máquina)"
  apt_instalar rabbitmq-server
  renderizar "$DIR_MODELOS/rabbitmq.conf" /etc/rabbitmq/rabbitmq.conf RABBITMQ_LIMITE_MEMORIA
  rabbitmq-plugins enable --offline rabbitmq_management rabbitmq_prometheus > /dev/null
  systemctl enable rabbitmq-server > /dev/null 2>&1
  systemctl restart rabbitmq-server
  local i
  for ((i = 0; i < 90; i++)); do
    rabbitmq-diagnostics -q ping > /dev/null 2>&1 && break
    sleep 1
  done
  rabbitmq-diagnostics -q ping > /dev/null 2>&1 \
    || erro "O RabbitMQ não respondeu. Veja: journalctl -u rabbitmq-server -n 50"

  if rabbitmqctl -q list_users --no-table-headers 2>/dev/null | awk '{print $1}' | grep -qx "$RABBITMQ_USER"; then
    rabbitmqctl -q change_password "$RABBITMQ_USER" "$RABBITMQ_PASSWORD" > /dev/null
  else
    rabbitmqctl -q add_user "$RABBITMQ_USER" "$RABBITMQ_PASSWORD" > /dev/null
  fi
  rabbitmqctl -q set_permissions -p / "$RABBITMQ_USER" ".*" ".*" ".*" > /dev/null
  rabbitmqctl -q set_user_tags "$RABBITMQ_USER" administrator > /dev/null
  rabbitmqctl -q delete_user guest > /dev/null 2>&1 || true
  ok "RabbitMQ no ar, usuário $RABBITMQ_USER, recusa mensagens acima de $RABBITMQ_LIMITE_MEMORIA da memória"
  info "Painel do RabbitMQ: só pela própria máquina (ssh -L 15672:127.0.0.1:15672 <S2>)"
}

escrever_envs_s2() {
  local banco rabbit valkey_s2
  banco=$(url_banco)
  rabbit="amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@127.0.0.1:5672"
  valkey_s2="redis://:${VALKEY_S2_SENHA}@127.0.0.1:${VALKEY_S2_PORTA}"

  escrever_env_servico ingestao-dados <<EOF
NODE_ENV=production
PORT=${PORTA[ingestao-dados]}
PUBLIC_API_URL=/ingestao
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
RABBITMQ_URL=$rabbit
RABBITMQ_RECOVERY_INTERVAL_MS=${RABBITMQ_RECOVERY_INTERVAL_MS:-10000}
MQTT_BROKER_URL=mqtt://127.0.0.1:1883
MQTT_QOS=$MQTT_QOS
# Staging das leituras (Valkey do S2)
REDIS_URL=$valkey_s2
EOF
  escrever_env_servico servico-validacao <<EOF
NODE_ENV=production
PORT=${PORTA[servico-validacao]}
PUBLIC_API_URL=/validacao
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
RABBITMQ_URL=$rabbit
EOF
  escrever_env_servico alertas-notificacoes <<EOF
NODE_ENV=production
PORT=${PORTA[alertas-notificacoes]}
PUBLIC_API_URL=/alertas
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=$JWT_EXPIRES_IN
RABBITMQ_URL=$rabbit
# Vazio = os avisos por e-mail falham e contam como tentativa (ver US-23)
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_SECURE=${SMTP_SECURE:-false}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
SMTP_FROM="${SMTP_FROM:-}"
EOF
  ok "3 arquivos em $DIR_CONF/servicos/"
  [[ -n "${SMTP_HOST:-}" ]] || aviso "SMTP_HOST vazio: os gestores não vão receber os avisos de alarme por e-mail."
}

verificar_s2() {
  local svc
  checar "Mosquitto ativo" systemctl is-active --quiet mosquitto
  checar "Mosquitto responde na 1883" mosquitto_sub -h 127.0.0.1 -p 1883 -t '$SYS/broker/version' -C 1 -W 5
  checar "RabbitMQ responde" rabbitmq-diagnostics -q ping
  checar "Valkey do S2 respondendo" valkey_ping "$VALKEY_S2_PORTA" "$VALKEY_S2_SENHA"
  for svc in "${SERVICOS_S2[@]}"; do
    checar "pulso@$svc ativo" systemctl is-active --quiet "pulso@$svc"
    checar "/${ROTA[$svc]}/health (porta ${PORTA[$svc]})" curl -fs -o /dev/null --max-time 5 \
      "http://127.0.0.1:${PORTA[$svc]}/${ROTA[$svc]}/health"
  done
  checar "alcança o banco ($S3_IP:5432)" esperar_porta "$S3_IP" 5432 3
  checar "node exporter ativo" systemctl is-active --quiet prometheus-node-exporter
}
