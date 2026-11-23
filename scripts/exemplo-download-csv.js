/**
 * Script de Exemplo (Node.js): Automação Diária de Download de CSV (Task 42.06 / US-42)
 *
 * Faz login em POST /auth/login, obtém o token Bearer JWT e baixa o CSV
 * de medições do dia anterior via GET /relatorios/medicoes?formato=csv.
 *
 * Exemplo de agendamento diário no crontab (todo dia às 08:00):
 *   0 8 * * * API_URL=http://localhost EMAIL=ana.silva@exemplo.com SENHA=... node /caminho/para/scripts/exemplo-download-csv.js >> /var/log/pulso_csv.log 2>&1
 *
 * Execução manual:
 *   node scripts/exemplo-download-csv.js
 */

const fs = require("node:fs");
const path = require("node:path");

function dataOntemIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const API_URL = process.env.API_URL || "http://localhost";
const EMAIL = process.env.EMAIL || "ana.silva@exemplo.com";
const SENHA = process.env.SENHA || "SenhaForte@2026";
const MUNICIPIO = process.env.MUNICIPIO || "";
const DATA_PADRAO = dataOntemIso();
const DATA_INICIO = process.env.DATA_INICIO || DATA_PADRAO;
const DATA_FIM = process.env.DATA_FIM || DATA_PADRAO;
const DESTINO_DIR =
  process.env.DIRETORIO_DESTINO || path.resolve(__dirname, "../downloads");

async function executarDownloadDiario() {
  if (!fs.existsSync(DESTINO_DIR)) {
    fs.mkdirSync(DESTINO_DIR, { recursive: true });
  }

  const arquivoSaida = path.join(
    DESTINO_DIR,
    `medicoes_${DATA_INICIO}_${DATA_FIM}.csv`,
  );

  console.log(`[1/3] Realizando login em ${API_URL}/auth/login...`);
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, senha: SENHA }),
  });

  if (!loginRes.ok) {
    const erroTxt = await loginRes.text();
    throw new Error(`Falha no login (HTTP ${loginRes.status}): ${erroTxt}`);
  }

  const loginBody = await loginRes.json();
  const token = loginBody?.token;
  if (!token) {
    throw new Error("Resposta de login não retornou token JWT.");
  }
  console.log("[2/3] Token JWT obtido com sucesso.");

  const params = new URLSearchParams({
    formato: "csv",
    inicio: DATA_INICIO,
    fim: DATA_FIM,
  });
  if (MUNICIPIO) {
    params.set("municipio", MUNICIPIO);
  }

  const csvUrl = `${API_URL}/relatorios/medicoes?${params.toString()}`;
  console.log(`[3/3] Baixando CSV de ${csvUrl}...`);
  const csvRes = await fetch(csvUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (csvRes.status === 429) {
    const cotaTxt = await csvRes.text();
    console.error(`[AVISO] Cota excedida (HTTP 429): ${cotaTxt}`);
    process.exitCode = 1;
    return;
  }

  if (!csvRes.ok) {
    const erroTxt = await csvRes.text();
    throw new Error(`Falha no download (HTTP ${csvRes.status}): ${erroTxt}`);
  }

  const contentType = csvRes.headers.get("content-type") || "";
  if (!contentType.includes("text/csv")) {
    const corpo = await csvRes.text();
    throw new Error(
      `Content-Type inesperado (${contentType}). Resposta: ${corpo}`,
    );
  }

  const csvContent = await csvRes.text();
  fs.writeFileSync(arquivoSaida, csvContent, "utf8");

  console.log(`Sucesso! CSV salvo em: ${arquivoSaida}`);
  const semanaRestante = csvRes.headers.get("x-cota-semana-restante");
  if (semanaRestante) {
    console.log(`Saldo de cota semanal restante: ${semanaRestante}`);
  }
}

executarDownloadDiario().catch((err) => {
  console.error("Erro na automação:", err.message);
  process.exitCode = 1;
});
