import { pool } from "../config/db";

export interface FiltrosMedicoes {
  municipio: string;
  de: number; // unixtime >= de
  ate: number; // unixtime < ate
  estacoes: string[] | null;
  grandezas: string[] | null;
}

// Como o pg devolve: BIGINT e NUMERIC chegam em texto.
export interface LinhaMedicao {
  id: string;
  unixtime: string;
  estacao_codigo: string;
  estacao_nome: string;
  municipio: string;
  sensor_codigo: string | null;
  grandeza: string;
  unidade: string;
  valor: string;
  valor_bruto: string;
  valida: boolean;
}

export interface ChaveLote {
  unixtime: string;
  id: string;
}

const COLUNAS = `
  SELECT m.id, m.unixtime, e.codigo AS estacao_codigo, e.nome AS estacao_nome, e.municipio,
         s.codigo AS sensor_codigo, s.tipo AS grandeza, s.unidade_medida AS unidade,
         m.valor, m.valor_bruto, m.valida`;

const DE_MEDIDAS = `
  FROM medidas m
  JOIN sensores s ON s.id = m.sensor_id
  JOIN estacoes e ON e.id = s.estacao_id
  WHERE e.municipio = $1 AND m.unixtime >= $2 AND m.unixtime < $3
    AND ($4::text[] IS NULL OR e.codigo = ANY($4))
    AND ($5::text[] IS NULL OR s.tipo = ANY($5))`;

const parametros = (f: FiltrosMedicoes) => [f.municipio, f.de, f.ate, f.estacoes, f.grandezas];

export async function existeEstacaoNoMunicipio(municipio: string): Promise<boolean> {
  const { rows } = await pool.query<{ existe: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM estacoes WHERE municipio = $1) AS existe",
    [municipio],
  );
  return rows[0].existe;
}

export async function contarMedicoes(filtros: FiltrosMedicoes): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT count(*) AS total ${DE_MEDIDAS}`,
    parametros(filtros),
  );
  return Number(rows[0].total);
}

// JSON: uma página.
export async function buscarMedicoes(
  filtros: FiltrosMedicoes,
  { pagina, porPagina }: { pagina: number; porPagina: number },
): Promise<LinhaMedicao[]> {
  const { rows } = await pool.query<LinhaMedicao>(
    `${COLUNAS} ${DE_MEDIDAS} ORDER BY m.unixtime, m.id LIMIT $6 OFFSET $7`,
    [...parametros(filtros), porPagina, (pagina - 1) * porPagina],
  );
  return rows;
}

// CSV: o lote seguinte à chave (unixtime, id) do último, sem OFFSET; `depoisDe` null é o primeiro.
export async function buscarLoteMedicoes(
  filtros: FiltrosMedicoes,
  depoisDe: ChaveLote | null,
  limite: number,
): Promise<LinhaMedicao[]> {
  const { rows } = await pool.query<LinhaMedicao>(
    `${COLUNAS} ${DE_MEDIDAS}
       AND ($6::bigint IS NULL OR (m.unixtime, m.id) > ($6::bigint, $7::uuid))
     ORDER BY m.unixtime, m.id LIMIT $8`,
    [...parametros(filtros), depoisDe?.unixtime ?? null, depoisDe?.id ?? null, limite],
  );
  return rows;
}
