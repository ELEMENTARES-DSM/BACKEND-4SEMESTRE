import { pool } from "../config/db";
import { AuthPayload, PERFIS } from "../middlewares/auth.middleware";

export interface ResultadoIqar {
  estacaoId: string;
  indice: number | string;
  classificacao?: string;
  cor?: string;
  municipio?: string;
}

export class ErroHttpIqar extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroHttpIqar";
  }
}

interface EstacaoRow {
  id: string;
  codigo: string;
  municipio: string;
}

interface MedicaoRow {
  valor: string | number;
  valida: boolean;
  unixtime: number;
}

export class IqarService {
  public async calcularIqarPorEstacao(params: {
    estacaoId: string;
    usuario?: AuthPayload;
  }): Promise<ResultadoIqar> {
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
      throw new ErroHttpIqar(404, "Estação não encontrada.");
    }

    if (usuario?.papel === PERFIS.GESTOR_PUBLICO) {
      const municipioUsuario = usuario.municipio?.trim().toLowerCase();
      const municipioEstacao = estacao.municipio?.trim().toLowerCase();

      if (!municipioUsuario || municipioUsuario !== municipioEstacao) {
        throw new ErroHttpIqar(404, "Estação não encontrada.");
      }
    }

    const agoraUnixtime = Math.floor(Date.now() / 1000);
    // Margem de 25h na query para evitar perda de dados nas bordas do timestamp
    const limite25hUnixtime = agoraUnixtime - 25 * 60 * 60;

    const query = `
      SELECT m.valor, m.valida, m.unixtime
      FROM medidas m
      INNER JOIN sensores s ON s.id = m.sensor_id
      WHERE s.estacao_id = $1::uuid
        AND UPPER(REPLACE(s.tipo, '.', '')) = 'PM25'
        AND m.unixtime >= $2
      ORDER BY m.unixtime DESC;
    `;

    const medidasResult = await pool.query<MedicaoRow>(query, [
      estacao.id,
      limite25hUnixtime,
    ]);
    const leituras = medidasResult.rows;

    if (leituras.length === 0 || this.possuiMenosDe24hDeHistorico(leituras)) {
      return {
        estacaoId,
        indice: "Sem dados suficientes",
        municipio: estacao.municipio,
      };
    }

    const leiturasValidas = leituras.filter((l) => l.valida === true);

    if (leiturasValidas.length === 0) {
      return {
        estacaoId,
        indice: "Sem dados suficientes",
        municipio: estacao.municipio,
      };
    }

    const soma = leiturasValidas.reduce(
      (acc, curr) => acc + Number(curr.valor),
      0,
    );
    const mediaPm25 = soma / leiturasValidas.length;

    const faixa = this.classificarFaixaIqar(mediaPm25);

    return {
      estacaoId,
      ...faixa,
      municipio: estacao.municipio,
    };
  }

  private possuiMenosDe24hDeHistorico(
    leituras: Array<{ unixtime: number }>,
  ): boolean {
    if (leituras.length === 0) return true;
    const menorUnixtime = Math.min(...leituras.map((l) => Number(l.unixtime)));
    const maiorUnixtime = Math.max(...leituras.map((l) => Number(l.unixtime)));

    const diffSegundos = maiorUnixtime - menorUnixtime;
    const diffHoras = diffSegundos / 3600;

    // Ajustado para 23h para acomodar o intervalo exato entre a primeira e a última leitura de uma série de 24h
    return diffHoras < 23;
  }

  private classificarFaixaIqar(valor: number): {
    indice: number;
    classificacao: string;
    cor: string;
  } {
    const indiceArredondado = Math.round(valor);

    if (valor <= 12) {
      return {
        indice: indiceArredondado,
        classificacao: "Boa",
        cor: "#00E400",
      };
    } else if (valor <= 35) {
      return {
        indice: indiceArredondado,
        classificacao: "Moderada",
        cor: "#FFFF00",
      };
    } else if (valor <= 55) {
      return {
        indice: indiceArredondado,
        classificacao: "Ruim",
        cor: "#FF7E00",
      };
    } else if (valor <= 150) {
      return {
        indice: indiceArredondado,
        classificacao: "Muito Ruim",
        cor: "#FF0000",
      };
    } else {
      return {
        indice: indiceArredondado,
        classificacao: "Péssima",
        cor: "#8F3F97",
      };
    }
  }
}