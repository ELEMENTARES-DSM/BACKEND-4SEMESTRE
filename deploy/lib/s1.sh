# shellcheck shell=bash
# S1 · Aplicação: nginx, site, auth-service, gestao-usuarios, gestao-estacoes,
# analise-dados, servico-relatorios e Valkey. Internet: só HTTPS (443).

instalar_s1() {
  exigir_vars S1_IP S2_IP S3_IP S4_IP REDE_ADMIN DOMINIO \
    POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD JWT_SECRET INTERNAL_TOKEN \
    VALKEY_S1_SENHA VALKEY_S1_PORTA VALKEY_S1_MAXMEMORY VALKEY_S2_SENHA VALKEY_S2_PORTA \
    REPO_BACKEND REF_BACKEND REPO_FRONTEND REF_FRONTEND NODE_MAJOR CERT_ARQUIVO CHAVE_ARQUIVO
  exigir_senhas_simples POSTGRES_PASSWORD VALKEY_S1_SENHA VALKEY_S2_SENHA

  preparar_sistema
  firewall_base
  instalar_valkey s1 "$VALKEY_S1_PORTA" "$VALKEY_S1_SENHA" "$VALKEY_S1_MAXMEMORY" "127.0.0.1"
  instalar_node
  criar_usuario_app
  instalar_nginx
  implantar_aplicacao s1
  recarregar_nginx

  etapa "Firewall do S1"
  firewall_permitir any 443 "site e API (HTTPS)"
  if [[ "${ABRIR_PORTA_80:-nao}" == "sim" ]]; then
    firewall_permitir any 80 "redireciona para o HTTPS"
  fi
  instalar_node_exporter
  instalar_redis_exporter "$VALKEY_S1_PORTA" "$VALKEY_S1_SENHA"
}

escrever_envs_s1() {
  local banco valkey_s1 valkey_s2
  banco=$(url_banco)
  valkey_s1="redis://:${VALKEY_S1_SENHA}@127.0.0.1:${VALKEY_S1_PORTA}"
  valkey_s2="redis://:${VALKEY_S2_SENHA}@${S2_IP}:${VALKEY_S2_PORTA}"

  escrever_env_servico auth-service <<EOF
NODE_ENV=production
PORT=${PORTA[auth-service]}
PUBLIC_API_URL=/auth
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=$JWT_EXPIRES_IN
# Lista de tokens revogados (Valkey do S1)
REDIS_URL=$valkey_s1
EOF
  escrever_env_servico gestao-usuarios <<EOF
NODE_ENV=production
PORT=${PORTA[gestao-usuarios]}
PUBLIC_API_URL=/usuarios
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=$JWT_EXPIRES_IN
REDIS_URL=$valkey_s1
EOF
  escrever_env_servico gestao-estacoes <<EOF
NODE_ENV=production
PORT=${PORTA[gestao-estacoes]}
PUBLIC_API_URL=/estacoes
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
INTERNAL_TOKEN=$INTERNAL_TOKEN
# Lê o staging da ingestão no Valkey do S2 (códigos de sensor que a estação já enviou)
REDIS_URL=$valkey_s2
EOF
  escrever_env_servico analise-dados <<EOF
NODE_ENV=production
PORT=${PORTA[analise-dados]}
PUBLIC_API_URL=/analise
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
# Cota de consultas dos munícipes (Valkey do S1)
REDIS_URL=$valkey_s1
GESTAO_ESTACOES_URL=http://127.0.0.1:${PORTA[gestao-estacoes]}
EOF
  escrever_env_servico servico-relatorios <<EOF
NODE_ENV=production
PORT=${PORTA[servico-relatorios]}
PUBLIC_API_URL=/relatorios
DATABASE_URL=$banco
JWT_SECRET=$JWT_SECRET
EOF
  ok "5 arquivos em $DIR_CONF/servicos/"
}

instalar_nginx() {
  etapa "nginx (HTTPS na 443, site e repasse da API)"
  apt_instalar nginx
  garantir_pasta "$(dirname "$CERT_ARQUIVO")" 0750
  garantir_pasta "$(dirname "$CHAVE_ARQUIVO")" 0750
  if [[ ! -s "$CERT_ARQUIVO" || ! -s "$CHAVE_ARQUIVO" ]]; then
    aviso "Certificado não encontrado em $CERT_ARQUIVO. Gerando um AUTOASSINADO (o navegador vai avisar)."
    aviso "Para produção, coloque o .crt e o .key da Prefeitura nesses caminhos e rode o instalador de novo."
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
      -keyout "$CHAVE_ARQUIVO" -out "$CERT_ARQUIVO" \
      -subj "/CN=$DOMINIO" -addext "subjectAltName=DNS:$DOMINIO,IP:$S1_IP" 2>/dev/null
  else
    ok "Certificado: $CERT_ARQUIVO (vence em $(openssl x509 -enddate -noout -in "$CERT_ARQUIVO" | cut -d= -f2))"
  fi
  chmod 0600 "$CHAVE_ARQUIVO"
  chmod 0644 "$CERT_ARQUIVO"

  renderizar "$DIR_MODELOS/nginx-cabecalhos.conf" /etc/nginx/snippets/pulso-cabecalhos.conf
  renderizar "$DIR_MODELOS/nginx-proxy.conf" /etc/nginx/snippets/pulso-proxy.conf
  renderizar "$DIR_MODELOS/nginx-pulso.conf" /etc/nginx/sites-available/pulso-urbano \
    S2_IP DOMINIO CERT_ARQUIVO CHAVE_ARQUIVO
  ln -sfn ../sites-available/pulso-urbano /etc/nginx/sites-enabled/pulso-urbano
  rm -f /etc/nginx/sites-enabled/default
  garantir_pasta "$WEB"
  garantir_pasta "$WEB/releases"
  nginx -t 2>&1 | sed 's/^/    /'
  systemctl enable nginx > /dev/null 2>&1
}

recarregar_nginx() {
  nginx -t > /dev/null 2>&1 || erro "Configuração do nginx inválida: rode 'nginx -t'"
  systemctl reload-or-restart nginx
  ok "nginx servindo https://$DOMINIO (e https://$S1_IP)"
}

verificar_s1() {
  local svc
  checar "nginx ativo" systemctl is-active --quiet nginx
  checar "Valkey do S1 respondendo" valkey_ping "$VALKEY_S1_PORTA" "$VALKEY_S1_SENHA"
  for svc in "${SERVICOS_S1[@]}"; do
    checar "pulso@$svc ativo" systemctl is-active --quiet "pulso@$svc"
  done
  checar "site abre em https://127.0.0.1/" curl -fsk -o /dev/null --max-time 5 https://127.0.0.1/
  for svc in "${SERVICOS_S1[@]}" alertas-notificacoes ingestao-dados servico-validacao; do
    checar "/${ROTA[$svc]}/health pelo nginx" curl -fsk -o /dev/null --max-time 5 "https://127.0.0.1/${ROTA[$svc]}/health"
  done
  checar "rota interna bloqueada para fora (404)" bash -c \
    '[[ "$(curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1/api/v1/internal/estacoes)" == 404 ]]'
  checar "alcança o banco ($S3_IP:5432)" esperar_porta "$S3_IP" 5432 3
  checar "alcança o Valkey do S2 ($S2_IP:$VALKEY_S2_PORTA)" esperar_porta "$S2_IP" "$VALKEY_S2_PORTA" 3
  checar "node exporter ativo" systemctl is-active --quiet prometheus-node-exporter
}
