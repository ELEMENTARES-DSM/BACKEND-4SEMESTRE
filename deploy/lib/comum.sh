# shellcheck shell=bash
# Funções usadas por todos os papéis (S1 a S4). Carregado por instalar.sh,
# deploy.sh e verificar.sh; não roda sozinho.

set -Eeuo pipefail
# No bash 5.2, "&" na substituição ${var//x/y} vira o texto encontrado.
# Desligado para que senhas e URLs entrem nos modelos como estão.
shopt -u patsub_replacement 2>/dev/null || true

DIR_CONF="/etc/pulso-urbano"
ARQ_CONF_PADRAO="$DIR_CONF/pulso.conf"
BASE="/opt/pulso-urbano"
DIR_LOG="/var/log/pulso-urbano"
DIR_MODELOS="$DIR_DEPLOY/modelos"
USUARIO_APP="pulso"

# --- Mensagens ----------------------------------------------------------------
if [[ -t 1 ]]; then
  _AZUL=$'\e[34m'; _VERDE=$'\e[32m'; _AMARELO=$'\e[33m'; _VERMELHO=$'\e[31m'; _FIM=$'\e[0m'
else
  _AZUL=""; _VERDE=""; _AMARELO=""; _VERMELHO=""; _FIM=""
fi
etapa() { printf '\n%s==> %s%s\n' "$_AZUL" "$*" "$_FIM"; }
info()  { printf '    %s\n' "$*"; }
ok()    { printf '    %s✓%s %s\n' "$_VERDE" "$_FIM" "$*"; }
aviso() { printf '    %s!%s %s\n' "$_AMARELO" "$_FIM" "$*" >&2; }
erro()  { printf '\n%sERRO:%s %s\n' "$_VERMELHO" "$_FIM" "$*" >&2; exit 1; }

_ao_falhar() {
  local codigo=$? linha=${BASH_LINENO[0]} comando=$BASH_COMMAND
  printf '\n%sFalhou%s (código %s) na linha %s: %s\n' "$_VERMELHO" "$_FIM" "$codigo" "$linha" "$comando" >&2
  [[ -n "${ARQ_LOG:-}" ]] && printf 'Log completo: %s\n' "$ARQ_LOG" >&2
}
trap _ao_falhar ERR

# Guarda tudo o que aparece na tela num arquivo de log, além de mostrar.
iniciar_log() {
  mkdir -p "$DIR_LOG"
  ARQ_LOG="$DIR_LOG/$1-$(date +%Y%m%d-%H%M%S).log"
  exec > >(tee -a "$ARQ_LOG") 2>&1
  info "Log: $ARQ_LOG"
}

# --- Checagens ----------------------------------------------------------------
exigir_root() {
  [[ $EUID -eq 0 ]] || erro "Rode como root: sudo $0 $*"
}

conferir_ubuntu() {
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    erro "Estes scripts são para Ubuntu Server (encontrado: ${PRETTY_NAME:-desconhecido})."
  fi
  if [[ "${VERSION_ID:-}" != "24.04" ]]; then
    aviso "Feito e testado para Ubuntu Server 24.04 LTS; esta máquina é ${PRETTY_NAME}."
  fi
}

carregar_config() {
  local arquivo=${1:-$ARQ_CONF_PADRAO}
  [[ -f "$arquivo" ]] || erro "Configuração não encontrada: $arquivo
    Gere com: sudo ./instalar.sh gerar-config > pulso.conf
    Depois copie para $ARQ_CONF_PADRAO (o mesmo arquivo nos 4 servidores)."
  local permissao
  permissao=$(stat -c '%a' "$arquivo")
  if [[ "$permissao" != "600" && "$permissao" != "400" ]]; then
    aviso "$arquivo tem senhas e está com permissão $permissao. Corrigindo para 600."
    chmod 600 "$arquivo"
  fi
  # shellcheck disable=SC1090
  . "$arquivo"
  ARQ_CONF="$arquivo"
  if [[ -n "${PROXY_HTTP:-}" ]]; then
    export http_proxy="$PROXY_HTTP" https_proxy="$PROXY_HTTP"
    export HTTP_PROXY="$PROXY_HTTP" HTTPS_PROXY="$PROXY_HTTP"
    export no_proxy="localhost,127.0.0.1,${S1_IP:-},${S2_IP:-},${S3_IP:-},${S4_IP:-}"
    export NO_PROXY="$no_proxy"
  fi
}

# Para cada nome: a variável precisa existir e não pode estar vazia.
exigir_vars() {
  local faltando=() v
  for v in "$@"; do
    [[ -n "${!v:-}" ]] || faltando+=("$v")
  done
  ((${#faltando[@]} == 0)) || erro "Preencha no $ARQ_CONF: ${faltando[*]}"
}

# Senhas entram em URLs de conexão: só letras e números.
exigir_senhas_simples() {
  local v
  for v in "$@"; do
    [[ -z "${!v:-}" || "${!v}" =~ ^[A-Za-z0-9]+$ ]] \
      || erro "$v tem caractere especial. Use só letras e números (ela entra numa URL de conexão)."
  done
}

# --- Pacotes ------------------------------------------------------------------
_APT_ATUALIZADO=""
apt_atualizar() {
  if [[ -z "$_APT_ATUALIZADO" ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get update -q
    _APT_ATUALIZADO=1
  fi
}

apt_instalar() {
  apt_atualizar
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

# adicionar_repo <nome> <url-da-chave> <linha "deb ..." sem o signed-by>
adicionar_repo() {
  local nome=$1 url_chave=$2 linha=$3
  local chave="/etc/apt/keyrings/$nome.gpg"
  garantir_pasta /etc/apt/keyrings
  if [[ ! -s "$chave" ]]; then
    curl -fsSL "$url_chave" | gpg --dearmor --yes -o "$chave"
    chmod 0644 "$chave"
  fi
  printf 'deb [signed-by=%s] %s\n' "$chave" "$linha" > "/etc/apt/sources.list.d/$nome.list"
  _APT_ATUALIZADO=""
}

configurar_proxy_apt() {
  local arq=/etc/apt/apt.conf.d/95pulso-proxy
  if [[ -n "${PROXY_HTTP:-}" ]]; then
    printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' "$PROXY_HTTP" "$PROXY_HTTP" > "$arq"
    ok "apt usando o proxy $PROXY_HTTP"
  else
    rm -f "$arq"
  fi
}

# --- Arquivos -------------------------------------------------------------------
# garantir_pasta <pasta> [modo] [dono:grupo]: cria só se não existir.
# (install -d numa pasta que já existe troca o modo dela; numa pasta do
# sistema, como /etc/ssl/certs, isso quebraria outros programas.)
garantir_pasta() {
  local dir=$1 modo=${2:-0755} dono=${3:-root:root}
  [[ -d "$dir" ]] && return 0
  install -d -m "$modo" -o "${dono%:*}" -g "${dono#*:}" "$dir"
}

# renderizar <modelo> <destino> VAR1 VAR2 ...
# Troca ${VAR} pelo valor de cada variável listada; o resto do texto
# (inclusive $host, $uri do nginx) fica como está.
renderizar() {
  local modelo=$1 destino=$2 conteudo v
  shift 2
  [[ -f "$modelo" ]] || erro "Modelo não encontrado: $modelo"
  conteudo=$(<"$modelo")
  for v in "$@"; do
    conteudo=${conteudo//"\${$v}"/"${!v-}"}
  done
  if [[ "$conteudo" =~ \$\{[A-Z][A-Z0-9_]*\} ]]; then
    erro "O modelo $modelo ainda tem ${BASH_REMATCH[0]} sem valor (faltou passar a variável)."
  fi
  mkdir -p "$(dirname "$destino")"
  printf '%s\n' "$conteudo" > "$destino.novo"
  mv -f "$destino.novo" "$destino"
}

# Escreve um arquivo de variáveis (KEY=valor) com permissão restrita.
# escrever_env <destino> <dono:grupo> <modo> <<'EOF' ... EOF
escrever_env() {
  local destino=$1 dono=$2 modo=$3
  mkdir -p "$(dirname "$destino")"
  install -m "$modo" -o "${dono%:*}" -g "${dono#*:}" /dev/null "$destino.novo"
  cat > "$destino.novo"
  mv -f "$destino.novo" "$destino"
}

# Troca (ou acrescenta) o trecho entre "# >>> pulso-urbano" e "# <<< pulso-urbano".
bloco_gerenciado() {
  local arquivo=$1 conteudo=$2
  local ini="# >>> pulso-urbano (gerado pelo instalador, não edite)" fim="# <<< pulso-urbano"
  touch "$arquivo"
  awk -v ini="$ini" -v fim="$fim" '
    index($0, "# >>> pulso-urbano") == 1 { pular = 1; next }
    index($0, fim) == 1 { pular = 0; next }
    !pular { print }
  ' "$arquivo" > "$arquivo.novo"
  printf '%s\n%s\n%s\n' "$ini" "$conteudo" "$fim" >> "$arquivo.novo"
  cat "$arquivo.novo" > "$arquivo"
  rm -f "$arquivo.novo"
}

# --- Espera -------------------------------------------------------------------
esperar_porta() {
  local host=$1 porta=$2 limite=${3:-60} i
  for ((i = 0; i < limite; i++)); do
    if (echo > "/dev/tcp/$host/$porta") 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

esperar_http() {
  local url=$1 limite=${2:-60} i
  for ((i = 0; i < limite; i++)); do
    if curl -fsk -o /dev/null --max-time 3 "$url"; then return 0; fi
    sleep 1
  done
  return 1
}

# --- Sistema --------------------------------------------------------------------
preparar_sistema() {
  etapa "Preparando o sistema"
  configurar_proxy_apt
  if [[ -n "${FUSO:-}" ]] && command -v timedatectl > /dev/null; then
    timedatectl set-timezone "$FUSO" 2>/dev/null || aviso "Não consegui ajustar o fuso para $FUSO"
  fi
  apt_instalar ca-certificates curl gnupg git openssl ufw jq iproute2
  garantir_pasta "$DIR_CONF"
  garantir_pasta "$BASE"
  garantir_pasta "$DIR_LOG"
  if ! timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -qx yes; then
    aviso "Relógio sem sincronização NTP. Token, backup e alertas dependem da hora certa: aponte o systemd-timesyncd para o NTP da Prefeitura."
  fi
  ok "Pacotes básicos instalados"
}

registrar_papel() {
  local papel=$1 arq="$DIR_CONF/papeis"
  touch "$arq"
  grep -qx "$papel" "$arq" || echo "$papel" >> "$arq"
}

papeis_instalados() {
  [[ -f "$DIR_CONF/papeis" ]] && cat "$DIR_CONF/papeis"
}

# --- Firewall -------------------------------------------------------------------
firewall_ligado() { [[ "${FIREWALL:-sim}" == "sim" ]]; }

firewall_base() {
  firewall_ligado || { aviso "FIREWALL=nao: o ufw não será configurado."; return 0; }
  etapa "Firewall (ufw): bloqueia tudo que chega, menos o que cada papel libera"
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  firewall_permitir "$REDE_ADMIN" 22 "SSH da rede de administração"
  # Não derruba quem está conectado agora: libera o IP de cada sessão SSH aberta.
  local ip
  while read -r ip; do
    [[ -n "$ip" ]] && firewall_permitir "$ip" 22 "SSH da sessão que rodou o instalador"
  done < <(ss -Htn state established '( sport = :22 )' 2>/dev/null \
            | awk '{print $NF}' | sed -E 's/^\[?([^]]*)\]?:[0-9]+$/\1/; s/^::ffff://' | sort -u)
  ufw --force enable > /dev/null
  ok "ufw ligado"
}

# firewall_permitir <origem|any> <porta> <descrição>
firewall_permitir() {
  firewall_ligado || return 0
  local origem=$1 porta=$2 descricao=$3
  ufw allow proto tcp from "$origem" to any port "$porta" comment "pulso: $descricao" > /dev/null
  info "porta $porta liberada para $origem ($descricao)"
}

# --- Coletores de métricas (o Prometheus do S4 lê) ---------------------------
instalar_node_exporter() {
  etapa "Coletor de métricas da máquina (node exporter, porta 9100)"
  apt_instalar prometheus-node-exporter
  garantir_pasta /var/lib/prometheus/node-exporter 0755 prometheus:prometheus
  cat > /etc/default/prometheus-node-exporter <<'EOF'
# Gerado pelo instalador do Pulso Urbano.
ARGS="--collector.systemd --collector.systemd.unit-include=(pulso.*|nginx|postgresql@.*|rabbitmq-server|mosquitto|grafana-server|prometheus.*)\\.service --collector.textfile.directory=/var/lib/prometheus/node-exporter"
EOF
  systemctl enable prometheus-node-exporter > /dev/null 2>&1
  systemctl restart prometheus-node-exporter
  firewall_permitir "$S4_IP" 9100 "métricas da máquina para o S4"
  ok "node exporter no ar"
}

# instalar_redis_exporter <porta-do-valkey> <senha>
instalar_redis_exporter() {
  local porta=$1 senha=$2
  etapa "Coletor de métricas do Valkey (porta 9121)"
  apt_instalar prometheus-redis-exporter
  escrever_env /etc/default/prometheus-redis-exporter root:root 0600 <<EOF
# Gerado pelo instalador do Pulso Urbano.
REDIS_ADDR=redis://127.0.0.1:$porta
REDIS_PASSWORD=$senha
ARGS=""
EOF
  systemctl enable prometheus-redis-exporter > /dev/null 2>&1
  systemctl restart prometheus-redis-exporter
  firewall_permitir "$S4_IP" 9121 "métricas do Valkey para o S4"
  ok "redis exporter lendo o Valkey da porta $porta"
}

# --- Configuração nova --------------------------------------------------------
_aleatorio() { openssl rand -hex "${1:-24}"; }

gerar_config() {
  local modelo="$DIR_DEPLOY/pulso.conf.exemplo" linha nome
  [[ -f "$modelo" ]] || erro "Não achei $modelo"
  while IFS= read -r linha || [[ -n "$linha" ]]; do
    if [[ "$linha" =~ ^([A-Z0-9_]+)=\"\"$ ]]; then
      nome=${BASH_REMATCH[1]}
      case "$nome" in
        SMTP_PASSWORD) ;; # é a senha do relay de e-mail da Prefeitura: quem preenche é a TI
        JWT_SECRET) linha="$nome=\"$(_aleatorio 32)\"" ;;
        INTERNAL_TOKEN|*PASSWORD|*SENHA) linha="$nome=\"$(_aleatorio 24)\"" ;;
      esac
    fi
    printf '%s\n' "$linha"
  done < "$modelo"
}

# --- Valkey (S1 e S2) -----------------------------------------------------------
# instalar_valkey <instância s1|s2> <porta> <senha> <maxmemory> <endereços de escuta>
# Cada instância tem configuração, dados e serviço próprios (pulso-valkey@s1,
# pulso-valkey@s2), para S1 e S2 poderem conviver numa mesma VM de teste.
instalar_valkey() {
  local VALKEY_INSTANCIA=$1 VALKEY_PORTA=$2 VALKEY_SENHA=$3 VALKEY_MAXMEMORY=$4 VALKEY_BIND=$5
  local VALKEY_DIR="/var/lib/pulso-urbano/valkey-$1"
  etapa "Valkey do ${VALKEY_INSTANCIA^^} (porta $VALKEY_PORTA, até $VALKEY_MAXMEMORY, grava em disco a cada escrita)"
  apt_instalar valkey-server valkey-tools
  # O serviço padrão do pacote ocupa a 6379; quem roda é o pulso-valkey@<instância>.
  systemctl disable --now valkey-server > /dev/null 2>&1 || true
  systemctl mask valkey-server > /dev/null 2>&1 || true
  install -d -m 0750 -o valkey -g valkey "$VALKEY_DIR"
  renderizar "$DIR_MODELOS/valkey.conf" "$DIR_CONF/valkey-$VALKEY_INSTANCIA.conf" \
    VALKEY_INSTANCIA VALKEY_BIND VALKEY_PORTA VALKEY_SENHA VALKEY_DIR VALKEY_MAXMEMORY
  chown root:valkey "$DIR_CONF/valkey-$VALKEY_INSTANCIA.conf"
  chmod 0640 "$DIR_CONF/valkey-$VALKEY_INSTANCIA.conf"
  renderizar "$DIR_MODELOS/pulso-valkey@.service" /etc/systemd/system/pulso-valkey@.service
  systemctl daemon-reload
  systemctl enable "pulso-valkey@$VALKEY_INSTANCIA" > /dev/null 2>&1
  systemctl restart "pulso-valkey@$VALKEY_INSTANCIA"
  local i
  for ((i = 0; i < 30; i++)); do
    if valkey_ping "$VALKEY_PORTA" "$VALKEY_SENHA"; then
      ok "Valkey $VALKEY_INSTANCIA respondendo"
      return 0
    fi
    sleep 1
  done
  erro "O Valkey $VALKEY_INSTANCIA não respondeu. Veja: journalctl -u pulso-valkey@$VALKEY_INSTANCIA -n 50"
}

# Endereços de escuta sem repetir (127.0.0.1 + IP interno, se for outro).
enderecos_escuta() {
  local ip=$1
  if [[ "$ip" == "127.0.0.1" || "$ip" == "localhost" ]]; then echo "127.0.0.1"; else echo "127.0.0.1 $ip"; fi
}

# --- Verificação ----------------------------------------------------------------
FALHAS=0
# checar <descrição> <comando...>: mostra ✓ ou ✗ e conta as falhas.
checar() {
  local descricao=$1
  shift
  if "$@" > /dev/null 2>&1; then
    ok "$descricao"
  else
    printf '    %s✗%s %s\n' "$_VERMELHO" "$_FIM" "$descricao"
    FALHAS=$((FALHAS + 1))
  fi
}

# A senha vai por variável de ambiente, não pela linha de comando
# (VALKEY_CLI_AUTH no Valkey 8+, REDISCLI_AUTH no 7.2 do Ubuntu 24.04).
valkey_ping() {
  VALKEY_CLI_AUTH="$2" REDISCLI_AUTH="$2" valkey-cli -p "$1" ping 2>/dev/null | grep -q PONG
}

# rodar_verificacao <papel>: as checagens não param o script no primeiro erro.
rodar_verificacao() {
  set +e
  trap - ERR
  "verificar_$1"
  set -e
  trap _ao_falhar ERR
}
