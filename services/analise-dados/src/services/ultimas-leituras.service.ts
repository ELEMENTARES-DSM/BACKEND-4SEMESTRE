import { pool } from "../config/db";
import { AuthPayload, PERFIS } from "../middlewares/auth.middleware";

export interface UltimaLeituraDto {
  grandeza: string;
  valorCalibrado: number;
  unidade: string;
  tempoRelativo: string;
}

export interface UltimasLeiturasResponse {
  estacaoId: string;
  leituras: UltimaLeituraDto[];
}

export class ErroHttpUltimasLeituras extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroHttpUltimasLeituras";
  }
}

interface EstacaoRow {
  id: string;
  codigo: string;
  municipio: string;
}

interface MedicaoRow {
  grandeza: string;
  valor_calibrado: string | number | null;
  valor: string | number;
  unidade: string | null;
  timestamp_leitura: string | Date;
}

export class UltimasLeiturasService {
  async obterUltimasLeituras(params: {
    estacaoId: string;
    usuario?: AuthPayload;
  }): Promise<UltimasLeiturasResponse> {
    const { estacaoId, usuario } = params;

    const estacaoResult = await pool.query<EstacaoRow>(
      `SELECT id, codigo, municipio
       FROM estacoes
       WHERE id::text = $1 OR UPPER(codigo) = UPPER($1)
       LIMIT 1`,
      [estacaoId.trim()],
    );

    const estacao = estacaoResult.rows[0];

    if (!estacao) {
      throw new ErroHttpUltimasLeituras(404, "Estação não encontrada.");
    }

    if (usuario?.papel === PERFIS.GESTOR_PUBLICO) {
      const municipioUsuario = usuario.municipio?.trim().toLowerCase();
      const municipioEstacao = estacao.municipio?.trim().toLowerCase();

      if (!municipioUsuario || municipioUsuario !== municipioEstacao) {
        throw new ErroHttpUltimasLeituras(404, "Estação não encontrada.");
      }
    }

    const query = `
      SELECT DISTINCT ON (s.tipo)
        s.tipo AS grandeza,
        m.valor AS valor_calibrado,
        m.valor,
        COALESCE(NULLIF(TRIM(s.unidade_medida), ''), NULLIF(TRIM(ts.unidade), '')) AS unidade,
        to_timestamp(m.unixtime) AS timestamp_leitura
      FROM medidas m
      INNER JOIN sensores s ON s.id = m.sensor_id
      LEFT JOIN tipos_sensor ts ON ts.nome = s.tipo
      WHERE s.estacao_id = $1::uuid
        AND m.valida = true
      ORDER BY s.tipo, m.unixtime DESC;
    `;

    const medidasResult = await pool.query<MedicaoRow>(query, [estacao.id]);
    const agora = new Date();

    const leituras: UltimaLeituraDto[] = medidasResult.rows.map((med) => {
      const dataLeitura = new Date(med.timestamp_leitura);
      const diffMs = agora.getTime() - dataLeitura.getTime();
      const diffMin = Math.max(0, Math.floor(diffMs / (1000 * 60)));

      let tempoRelativo = `há ${diffMin} min`;
      if (diffMin === 0) {
        tempoRelativo = "agora mesmo";
      } else if (diffMin === 1) {
        tempoRelativo = "há 1 min";
      }

      return {
        grandeza: med.grandeza.trim(),
        valorCalibrado: Number(med.valor_calibrado ?? med.valor),
        unidade: med.unidade?.trim() || "",
        tempoRelativo,
      };
    });

    return {
      estacaoId,
      leituras,
    };
  }
}
