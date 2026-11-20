import { pool } from "../config/db";
import { AuthPayload, PERFIS } from "../middlewares/auth.middleware";

// Janela móvel estrita de 24h para a média de PM2.5 (US-35 / ELEM-200).
export const JANELA_IQAR_SEGUNDOS = 24 * 60 * 60;

// Mínimo de 23h entre a primeira e a última leitura válida dentro da janela de 24h,
// acomodando séries horárias de 24 leituras (ex.: 20h de ontem até 19h de hoje = 23h).
export const HISTORICO_MINIMO_HORAS = 23;

export const SEM_DADOS_SUFICIENTES = "Sem dados suficientes";

// Faixas oficiais brasileiras do IQAr para MP2,5 (média 24h em µg/m³),
// conforme Resolução CONAMA nº 506/2024 e Orientação Técnica do MMA/CETESB (DEC-6).
export const FAIXAS_IQAR_PM25 = [
  {
    maximo: 15,
    classificacao: "Boa",
    cor: "#00E400",
    mensagem: "Qualidade do ar considerada boa.",
  },
  {
    maximo: 50,
    classificacao: "Moderada",
    cor: "#FFFF00",
    mensagem: "Qualidade do ar considerada moderada.",
  },
  {
    maximo: 75,
    classificacao: "Ruim",
    cor: "#FF7E00",
    mensagem: "Qualidade do ar considerada ruim.",
  },
  {
    maximo: 125,
    classificacao: "Muito Ruim",
    cor: "#FF0000",
    mensagem: "Qualidade do ar considerada muito ruim.",
  },
] as const;

export const FAIXA_PESSIMA = {
  classificacao: "Péssima",
  cor: "#8F3F97",
  mensagem: "Qualidade do ar considerada péssima.",
} as const;

export interface ResultadoIqar {
  estacaoId: string;
  indice: number | string;
  status: string;
  rotuloFaixa: string;
  mensagem: string;
  classificacao?: string;
  cor?: string;
  municipio: string;
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
  unixtime: string | number;
}

export class IqarService {
  constructor(private readonly agoraMs: () => number = () => Date.now()) {}

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

    const agoraUnixtime = Math.floor(this.agoraMs() / 1000);
    const inicioJanelaUnixtime = agoraUnixtime - JANELA_IQAR_SEGUNDOS;

    const query = `
      SELECT m.valor, m.valida, m.unixtime
      FROM medidas m
      INNER JOIN sensores s ON s.id = m.sensor_id
      WHERE s.estacao_id = $1::uuid
        AND UPPER(REPLACE(s.tipo, '.', '')) = 'PM25'
        AND m.valida = true
        AND m.unixtime >= $2
        AND m.unixtime <= $3
      ORDER BY m.unixtime DESC;
    `;

    const medidasResult = await pool.query<MedicaoRow>(query, [
      estacao.id,
      inicioJanelaUnixtime,
      agoraUnixtime,
    ]);

    // Filtra medidas inválidas antes de verificar o histórico mínimo de 24h (US-19).
    const leiturasValidas = medidasResult.rows.filter(
      (l) => l.valida === true,
    );

    if (
      leiturasValidas.length === 0 ||
      this.possuiMenosDe24hDeHistorico(leiturasValidas)
    ) {
      return {
        estacaoId,
        indice: SEM_DADOS_SUFICIENTES,
        status: SEM_DADOS_SUFICIENTES,
        rotuloFaixa: SEM_DADOS_SUFICIENTES,
        mensagem: "Não há dados suficientes para calcular o IQAr.",
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
      indice: faixa.indice,
      classificacao: faixa.classificacao,
      status: faixa.classificacao,
      rotuloFaixa: faixa.classificacao,
      cor: faixa.cor,
      mensagem: faixa.mensagem,
      municipio: estacao.municipio,
    };
  }

  private possuiMenosDe24hDeHistorico(
    leituras: Array<{ unixtime: string | number }>,
  ): boolean {
    if (leituras.length < 2) return true;

    let menorUnixtime = Number(leituras[0].unixtime);
    let maiorUnixtime = menorUnixtime;

    for (const leitura of leituras) {
      const ts = Number(leitura.unixtime);
      if (ts < menorUnixtime) menorUnixtime = ts;
      if (ts > maiorUnixtime) maiorUnixtime = ts;
    }

    const diffHoras = (maiorUnixtime - menorUnixtime) / 3600;
    return diffHoras < HISTORICO_MINIMO_HORAS;
  }

  private classificarFaixaIqar(valor: number): {
    indice: number;
    classificacao: string;
    cor: string;
    mensagem: string;
  } {
    const indice = Math.round(valor);

    for (const faixa of FAIXAS_IQAR_PM25) {
      if (valor <= faixa.maximo) {
        return {
          indice,
          classificacao: faixa.classificacao,
          cor: faixa.cor,
          mensagem: faixa.mensagem,
        };
      }
    }

    return {
      indice,
      classificacao: FAIXA_PESSIMA.classificacao,
      cor: FAIXA_PESSIMA.cor,
      mensagem: FAIXA_PESSIMA.mensagem,
    };
  }
}
