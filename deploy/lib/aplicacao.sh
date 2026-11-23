# shellcheck shell=bash
# Construção e implantação dos serviços Node.js (S1 e S2) e do site (S1).
#
# Cada versão fica em /opt/pulso-urbano/releases/<papel>-<data>-<commit>/<serviço>.
# O systemd roda /opt/pulso-urbano/servicos/<serviço>, que é um link para a
# versão ativa. Voltar uma versão é trocar os links e reiniciar.

SRC="$BASE/src"
RELEASES="$BASE/releases"
LINKS="$BASE/servicos"
WEB="/var/www/pulso-urbano"

# Porta de cada serviço (a padrão do server.ts; o gestao-usuarios sai da 3001,
# que é do auth-service, para a 3008) e o prefixo das rotas no nginx.
declare -A PORTA=(
  [auth-service]=3001 [alertas-notificacoes]=3002 [analise-dados]=3003
  [gestao-estacoes]=3004 [ingestao-dados]=3005 [servico-relatorios]=3006
  [servico-validacao]=3007 [gestao-usuarios]=3008
)
declare -A ROTA=(
  [auth-service]=auth [alertas-notificacoes]=alertas [analise-dados]=analise
  [gestao-estacoes]=estacoes [ingestao-dados]=ingestao [servico-relatorios]=relatorios
  [servico-validacao]=validacao [gestao-usuarios]=usuarios
)
SERVICOS_S1=(auth-service gestao-usuarios gestao-estacoes analise-dados servico-relatorios)
SERVICOS_S2=(ingestao-dados servico-validacao alertas-notificacoes)
# Ordem das migrations: as tabelas de cada serviço apontam para as dos anteriores.
MIGRATIONS_ORDEM=(gestao-usuarios gestao-estacoes servico-validacao alertas-notificacoes ingestao-dados)

export NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NPM_CONFIG_UPDATE_NOTIFIER=false
export NPM_CONFIG_LOGLEVEL=warn

servicos_do_papel() {
  case "$1" in
    s1) echo "${SERVICOS_S1[@]}" ;;
    s2) echo "${SERVICOS_S2[@]}" ;;
    *) erro "O papel $1 não tem serviços Node.js" ;;
  esac
}

url_banco() {
  printf 'postgresql://%s:%s@%s:5432/%s' "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$S3_IP" "$POSTGRES_DB"
}

# --- Node.js e usuário ---------------------------------------------------------
instalar_node() {
  etapa "Node.js $NODE_MAJOR (repositório oficial NodeSource)"
  if command -v node > /dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" == "$NODE_MAJOR" ]]; then
    ok "Node.js $(node -v) já instalado"
    return 0
  fi
  adicionar_repo nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    "https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main"
  # Prefere o pacote da NodeSource ao nodejs (mais antigo) do Ubuntu.
  cat > /etc/apt/preferences.d/nodesource <<'EOF'
Package: nodejs
Pin: origin deb.nodesource.com
Pin-Priority: 600
EOF
  apt_instalar nodejs
  ok "Node.js $(node -v) e npm $(npm -v)"
}

criar_usuario_app() {
  if ! id "$USUARIO_APP" > /dev/null 2>&1; then
    getent group "$USUARIO_APP" > /dev/null || groupadd --system "$USUARIO_APP"
    useradd --system --gid "$USUARIO_APP" --home-dir /nonexistent --no-create-home \
      --shell /usr/sbin/nologin "$USUARIO_APP"
    ok "Usuário de sistema '$USUARIO_APP' criado (os serviços rodam com ele, sem root)"
  fi
  install -d -m 0750 -o root -g "$USUARIO_APP" "$DIR_CONF/servicos" # pasta nossa: força o modo
  garantir_pasta "$SRC"
  garantir_pasta "$RELEASES"
  garantir_pasta "$LINKS"
}

# --- Código --------------------------------------------------------------------
# atualizar_codigo <repositório> <ref> <pasta>: baixa só o commit pedido.
atualizar_codigo() {
  local repo=$1 ref=$2 dir=$3
  if [[ ! -d "$dir/.git" ]]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "$repo"
  fi
  git -C "$dir" remote set-url origin "$repo"
  git -C "$dir" fetch -q --depth 1 origin "$ref" \
    || erro "Não consegui baixar '$ref' de $repo (a branch/tag existe? a máquina alcança o GitHub?)"
  git -C "$dir" checkout -qf FETCH_HEAD
  git -C "$dir" clean -qfdx -e node_modules
  info "$(basename "$dir"): $ref = $(git -C "$dir" log -1 --format='%h %s')"
}

commit_curto() { git -C "$1" rev-parse --short HEAD; }

# --- Construção dos serviços ---------------------------------------------------
# construir_servicos <pasta-da-release> <serviço>...
construir_servicos() {
  local rel=$1 svc dir
  shift
  for svc in "$@"; do
    dir="$SRC/backend/services/$svc"
    [[ -d "$dir" ]] || erro "Serviço $svc não existe em $REF_BACKEND"
    info "construindo $svc..."
    (cd "$dir" && npm ci --no-audit --no-fund > /dev/null && npm run build > /dev/null) \
      || erro "Falhou o build de $svc (rode 'npm ci && npm run build' em $dir para ver o erro)"
    [[ -f "$dir/dist/server.js" ]] || erro "$svc: o build não gerou dist/server.js"
    install -d "$rel/$svc"
    cp -a "$dir/dist" "$dir/package.json" "$dir/package-lock.json" "$rel/$svc/"
    (cd "$rel/$svc" && npm ci --omit=dev --no-audit --no-fund > /dev/null)
    ok "$svc"
  done
  chmod -R a+rX,go-w "$rel"
}

# --- Site (S1) ------------------------------------------------------------------
construir_frontend() {
  local dir="$SRC/frontend" rel
  atualizar_codigo "$REPO_FRONTEND" "$REF_FRONTEND" "$dir"
  cat > "$dir/.env" <<'EOF'
VITE_API_URL=/
VITE_DEV_AUTH_BYPASS=false
VITE_AMBIENTE=producao
VITE_USE_MOCKS=false
EOF
  info "construindo o site..."
  (
    cd "$dir" \
      && npm ci --no-audit --no-fund > /dev/null \
      && { ! grep -q '"validate:env"' package.json || npm run -s validate:env; } \
      && npm run build > /dev/null
  ) || erro "Falhou o build do site (rode 'npm ci && npm run build' em $dir para ver o erro)"
  [[ -f "$dir/dist/index.html" ]] || erro "O build do site não gerou dist/index.html"
  rel="$WEB/releases/$(date +%Y%m%d-%H%M%S)-$(commit_curto "$dir")"
  install -d "$rel"
  cp -a "$dir/dist/." "$rel/"
  chmod -R a+rX,go-w "$rel"
  SITE_NOVO="$rel"
  ok "site em $rel"
}

ativar_frontend() {
  local destino=$1
  ln -sfn "$destino" "$WEB/atual.novo"
  mv -Tf "$WEB/atual.novo" "$WEB/atual"
}

# --- Versões ----------------------------------------------------------------------
release_ativa() {
  # A versão ativa de um papel é a pasta para onde aponta o link do 1º serviço.
  local svc=$1
  [[ -L "$LINKS/$svc" ]] && dirname "$(readlink -f "$LINKS/$svc")"
}

# ativar_release <pasta> <serviço>...
ativar_release() {
  local rel=$1 svc
  shift
  for svc in "$@"; do
    [[ -d "$rel/$svc" ]] || erro "A versão $rel não tem $svc"
    ln -sfn "$rel/$svc" "$LINKS/$svc.novo"
    mv -Tf "$LINKS/$svc.novo" "$LINKS/$svc"
  done
  local nome=${rel##*/}
  echo "$rel" > "$DIR_CONF/versao-${nome%%-*}"
}

# release_anterior <papel>: a versão mais nova antes da ativa.
release_anterior() {
  local papel=$1 primeiro ativa
  read -r primeiro _ <<< "$(servicos_do_papel "$papel")"
  ativa=$(release_ativa "$primeiro" || true)
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name "$papel-*" | sort \
    | awk -v ativa="$ativa" '$0 == ativa { print anterior; exit } { anterior = $0 }'
}

limpar_releases() {
  local papel=$1 guardar=${RELEASES_GUARDADAS:-5} primeiro ativa
  read -r primeiro _ <<< "$(servicos_do_papel "$papel")"
  ativa=$(release_ativa "$primeiro" || true)
  find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name "$papel-*" | sort -r \
    | tail -n +"$((guardar + 1))" | while read -r velha; do
        [[ "$velha" == "$ativa" ]] || rm -rf "$velha"
      done
  if [[ "$papel" == "s1" && -d "$WEB/releases" ]]; then
    local site_ativo
    site_ativo=$(readlink -f "$WEB/atual" || true)
    find "$WEB/releases" -mindepth 1 -maxdepth 1 -type d | sort -r \
      | tail -n +"$((guardar + 1))" | while read -r velha; do
          [[ "$velha" == "$site_ativo" ]] || rm -rf "$velha"
        done
  fi
}

# --- systemd ----------------------------------------------------------------------
instalar_unit_servicos() {
  renderizar "$DIR_MODELOS/pulso@.service" /etc/systemd/system/pulso@.service
  systemctl daemon-reload
}

# reiniciar_servicos <serviço>...: devolve erro se algum não responder no /health.
reiniciar_servicos() {
  local svc falhou=()
  for svc in "$@"; do
    systemctl enable "pulso@$svc" > /dev/null 2>&1
    systemctl restart "pulso@$svc"
  done
  for svc in "$@"; do
    if esperar_http "http://127.0.0.1:${PORTA[$svc]}/${ROTA[$svc]}/health" ${ESPERA_HEALTH:-90}; then
      ok "$svc respondendo na porta ${PORTA[$svc]}"
    else
      aviso "$svc não respondeu em /${ROTA[$svc]}/health. Veja: journalctl -u pulso@$svc -n 50"
      falhou+=("$svc")
    fi
  done
  ((${#falhou[@]} == 0))
}

# escrever_env_servico <serviço> <<EOF ... EOF
escrever_env_servico() {
  escrever_env "$DIR_CONF/servicos/$1.env" "root:$USUARIO_APP" 0640
}

# --- Banco ------------------------------------------------------------------------
# Roda as 5 migrations na ordem certa. Pode rodar do S1 ou do S2: o que já
# rodou é pulado, e o node-pg-migrate trava o banco enquanto roda.
migrar_banco() {
  etapa "Migrations do banco (S3 em $S3_IP)"
  esperar_porta "$S3_IP" 5432 30 \
    || erro "O PostgreSQL do S3 ($S3_IP:5432) não responde. Instale o S3 antes, ou confira o firewall dele."
  local svc dir url
  url=$(url_banco)
  for svc in "${MIGRATIONS_ORDEM[@]}"; do
    dir="$SRC/backend/services/$svc"
    if [[ ! -d "$dir/node_modules/node-pg-migrate" ]]; then
      (cd "$dir" && npm ci --no-audit --no-fund > /dev/null)
    fi
    (cd "$dir" && DATABASE_URL="$url" npm run -s migrate -- up > /dev/null) \
      || erro "Falhou a migration de $svc (rode em $dir: DATABASE_URL=... npm run migrate -- up)"
    ok "$svc"
  done
}

# A migration cria admin@exemplo.com com uma senha de teste conhecida.
# Troca pelo ADMIN_EMAIL/ADMIN_SENHA da configuração na primeira instalação.
trocar_admin_inicial() {
  if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_SENHA:-}" ]]; then
    aviso "ADMIN_EMAIL/ADMIN_SENHA vazios: o admin de teste admin@exemplo.com continua com a senha do repositório. Troque antes de abrir o site."
    return 0
  fi
  local resultado
  resultado=$(cd "$SRC/backend/services/gestao-usuarios" \
    && DATABASE_URL="$(url_banco)" NOVO_EMAIL="$ADMIN_EMAIL" NOVA_SENHA="$ADMIN_SENHA" node -e '
      const bcrypt = require("bcryptjs");
      const { Client } = require("pg");
      (async () => {
        const c = new Client({ connectionString: process.env.DATABASE_URL });
        await c.connect();
        const teste = await c.query("SELECT 1 FROM usuarios WHERE email = $1", ["admin@exemplo.com"]);
        const existe = await c.query("SELECT 1 FROM usuarios WHERE email = $1", [process.env.NOVO_EMAIL]);
        if (teste.rowCount === 0) { console.log("ja-trocado"); }
        else if (existe.rowCount > 0) { console.log("email-em-uso"); }
        else {
          const hash = await bcrypt.hash(process.env.NOVA_SENHA, 10);
          await c.query("UPDATE usuarios SET email = $1, senha_hash = $2 WHERE email = $3",
            [process.env.NOVO_EMAIL, hash, "admin@exemplo.com"]);
          console.log("trocado");
        }
        await c.end();
      })().catch((e) => { console.error(e.message); process.exit(1); });
    ') || resultado="erro"
  case "$resultado" in
    trocado) ok "Administrador inicial agora é $ADMIN_EMAIL (senha do pulso.conf)" ;;
    ja-trocado) ok "Administrador de teste já tinha sido trocado" ;;
    email-em-uso) aviso "$ADMIN_EMAIL já existe; o admin@exemplo.com ficou como está. Inative-o pela tela de Usuários." ;;
    *) aviso "Não consegui trocar o administrador inicial: $resultado" ;;
  esac
}

# --- Implantação ------------------------------------------------------------------
# implantar_aplicacao <s1|s2>: constrói, migra, troca a versão e reinicia.
# Se algum serviço não subir, volta sozinho para a versão anterior.
implantar_aplicacao() {
  local papel=$1 servicos rel anterior site_anterior=""
  read -r -a servicos <<< "$(servicos_do_papel "$papel")"

  etapa "Baixando o código (backend: $REF_BACKEND)"
  atualizar_codigo "$REPO_BACKEND" "$REF_BACKEND" "$SRC/backend"
  rel="$RELEASES/$papel-$(date +%Y%m%d-%H%M%S)-$(commit_curto "$SRC/backend")"

  etapa "Construindo os serviços do ${papel^^}"
  construir_servicos "$rel" "${servicos[@]}"
  if [[ "$papel" == "s1" ]]; then
    etapa "Construindo o site (frontend: $REF_FRONTEND)"
    construir_frontend
  fi

  migrar_banco
  if [[ "$papel" == "s1" ]]; then trocar_admin_inicial; fi

  etapa "Variáveis de ambiente dos serviços"
  "escrever_envs_$papel"
  instalar_unit_servicos

  etapa "Ativando a versão $(basename "$rel")"
  anterior=$(release_ativa "${servicos[0]}" || true)
  if [[ "$papel" == "s1" ]]; then site_anterior=$(readlink -f "$WEB/atual" 2>/dev/null || true); fi
  ativar_release "$rel" "${servicos[@]}"
  if [[ "$papel" == "s1" ]]; then ativar_frontend "$SITE_NOVO"; fi

  if ! reiniciar_servicos "${servicos[@]}"; then
    if [[ -n "$anterior" && -d "$anterior" ]]; then
      aviso "Voltando para a versão anterior: $(basename "$anterior")"
      ativar_release "$anterior" "${servicos[@]}"
      if [[ -n "$site_anterior" ]]; then ativar_frontend "$site_anterior"; fi
      reiniciar_servicos "${servicos[@]}" || true
      erro "A versão nova não subiu e a anterior foi restaurada. As migrations que rodaram ficam no banco."
    fi
    erro "Serviços sem resposta. Veja os logs com: journalctl -u 'pulso@*' -n 100"
  fi
  limpar_releases "$papel"
  ok "Versão ativa: $(basename "$rel")"
}
