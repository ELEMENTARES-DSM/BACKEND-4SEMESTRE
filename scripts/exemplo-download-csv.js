/**
 * Script de Exemplo (Node.js): Automação Diária de Download de CSV (Task 42.06 / US-42)
 *
 * Execução:
 *   node scripts/exemplo-download-csv.js
 */

const fs = require("node:fs");
const path = require("node:path");

const API_URL = process.env.API_URL || "http://localhost:8080";
const EMAIL = process.env.EMAIL || "ana.silva@exemplo.com";
const SENHA = process.env.SENHA || "SenhaForte@2026";
const PERIODO = process.env.PERIODO || "24h";
const DESTINO_DIR = process.env.DIRETORIO_DESTINO || path.resolve(__dirname, "../downloads");

async function executarDownloadDiario() {
  if (!fs.existsSync(DESTINO_DIR)) {
    fs.mkdirSync(DESTINO_DIR, { recursive: true });
  }

  const dataHoje = new Date().toISOString().split("T")[0];
  const arquivoSaida = path.join(DESTINO_DIR, `leituras_${dataHoje}.csv`);

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

  const { token } = await loginRes.json();
  console.log("[2/3] Token JWT obtido com sucesso.");

  console.log(`[3/3] Baixando CSV de ${API_URL}/analise/exportar/csv?periodo=${PERIODO}...`);
  const csvRes = await fetch(`${API_URL}/analise/exportar/csv?periodo=${PERIODO}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (csvRes.status === 429) {
    const cotaTxt = await csvRes.text();
    console.warn(`[AVISO] Cota excedida (HTTP 429): ${cotaTxt}`);
    return;
  }

  if (!csvRes.ok) {
    const erroTxt = await csvRes.text();
    throw new Error(`Falha no download (HTTP ${csvRes.status}): ${erroTxt}`);
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
