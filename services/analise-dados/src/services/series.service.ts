import { pool } from "../config/db";
import { AuthPayload, PERFIS } from "../middlewares/auth.middleware";

export type PeriodoSeries = "24h" | "7d" | "30d";

export interface PontoSerie {
  timestamp: string;
  valor: number;
}

export interface SeriesResponse {
  estacaoId: string;
  grandeza: string;
  periodo: PeriodoSeries;
  dados: PontoSerie[];
}

export class ErroHttpSeries extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroHttpSeries";
  }
}

interface EstacaoRow {
  id: string;
  codigo: string;
  municipio: string;
}

interface MedidaAgregadaRow {
  bucket_brt: string;
  media_valor: string | number;
}

export function formatarTimestampBrasilia(bucketBrt: string | Date): string {
  if (bucketBrt instanceof Date) {
    const partes = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(bucketBrt)
      .replace(" ", "T");
    return `${partes}-03:00`;
  }

  const limpo = String(bucketBrt).trim().replace(" ", "T");
  if (/[+-]\d{2}:\d{2}$|Z$/i.test(limpo)) {
    return limpo;
  }
  return `${limpo}-03:00`;
}

function obterExpressaoBucketSql(periodo: PeriodoSeries): {
  expressaoGrupo: string;
  intervaloSql: string;
} {
  const tsBrasilia = `(to_timestamp(m.unixtime) AT TIME ZONE 'America/Sao_Paulo')`;

  switch (periodo) {
    case "24h":
      return {
        expressaoGrupo: `date_trunc('hour', ${tsBrasilia}) + (FLOOR(EXTRACT(MINUTE FROM ${tsBrasilia}) / 5) * INTERVAL '5 minutes')`,
        intervaloSql: "24 hours",
      };
    case "7d":
      return {
        expressaoGrupo: `date_trunc('hour', ${tsBrasilia})`,
        intervaloSql: "7 days",
      };
    case "30d":
      return {
        expressaoGrupo: `date_trunc('day', ${tsBrasilia})`,
        intervaloSql: "30 days",
      };
  }
}

export async function obterSeriesHistoricas(params: {
  estacaoId: string;
  grandeza: string;
  periodo: PeriodoSeries;
  usuario?: AuthPayload;
}): Promise<SeriesResponse> {
  const { estacaoId, grandeza, periodo, usuario } = params;

  const estacaoResult = await pool.query<EstacaoRow>(
    `SELECT id, codigo, municipio
     FROM estacoes
     WHERE id::text = $1 OR UPPER(codigo) = UPPER($1)
     LIMIT 1`,
    [estacaoId.trim()],
  );

  const estacao = estacaoResult.rows[0];

  if (!estacao) {
    throw new ErroHttpSeries(404, "Estação não encontrada.");
  }

  if (usuario?.papel === PERFIS.GESTOR_PUBLICO) {
    const municipioUsuario = usuario.municipio?.trim().toLowerCase();
    const municipioEstacao = estacao.municipio?.trim().toLowerCase();

    if (!municipioUsuario || municipioUsuario !== municipioEstacao) {
      throw new ErroHttpSeries(404, "Estação não encontrada.");
    }
  }

  const { expressaoGrupo, intervaloSql } = obterExpressaoBucketSql(periodo);

  const medidasResult = await pool.query<MedidaAgregadaRow>(
    `SELECT
       to_char(${expressaoGrupo}, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket_brt,
       ROUND(AVG(m.valor)::numeric, 2) AS media_valor
     FROM medidas m
     INNER JOIN sensores s ON s.id = m.sensor_id
     WHERE s.estacao_id = $1::uuid
       AND REPLACE(UPPER(s.tipo), '.', '') = REPLACE(UPPER($2), '.', '')
       AND m.valida = true
       AND to_timestamp(m.unixtime) >= (CURRENT_TIMESTAMP - ($3)::interval)
     GROUP BY ${expressaoGrupo}
     ORDER BY ${expressaoGrupo} ASC`,
    [estacao.id, grandeza.trim(), intervaloSql],
  );

  const dados: PontoSerie[] = medidasResult.rows.map((row) => ({
    timestamp: formatarTimestampBrasilia(row.bucket_brt),
    valor: Number(row.media_valor),
  }));

  return {
    estacaoId,
    grandeza: grandeza.trim(),
    periodo,
    dados,
  };
}
