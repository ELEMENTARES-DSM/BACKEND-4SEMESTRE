import { pool } from "../config/db";
import {
  obterSeriesHistoricas,
  PeriodoSeries,
  SeriesResponse,
} from "./series.service";
import {
  UltimasLeiturasResponse,
  UltimasLeiturasService,
} from "./ultimas-leituras.service";

export interface IqarPublicoResponse {
  indice: number;
  classificacao: string;
  cor: string;
  municipio: string;
}

export class ErroHttpPublicAnalise extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ErroHttpPublicAnalise";
  }
}

interface EstacaoPublicaRow {
  id: string;
  codigo: string;
  municipio: string;
}

export class PublicAnaliseService {
  constructor(
    private readonly ultimasLeiturasService: UltimasLeiturasService = new UltimasLeiturasService(),
  ) {}

  async obterSeriesPublicas(params: {
    municipio: string;
    codigo: string;
    grandeza: string;
    periodo: PeriodoSeries;
  }): Promise<SeriesResponse> {
    const municipio = params.municipio.trim();
    const codigo = params.codigo.trim();

    if (!municipio || !codigo) {
      throw new ErroHttpPublicAnalise(404, "Estação não encontrada.");
    }

    return obterSeriesHistoricas({
      estacaoId: codigo,
      grandeza: params.grandeza,
      periodo: params.periodo,
      municipio,
      apenasAtivas: true,
    });
  }

  async obterUltimasLeiturasPublicas(params: {
    municipio: string;
    codigo: string;
  }): Promise<UltimasLeiturasResponse> {
    const municipio = params.municipio.trim();
    const codigo = params.codigo.trim();

    if (!municipio || !codigo) {
      throw new ErroHttpPublicAnalise(404, "Estação não encontrada.");
    }

    return this.ultimasLeiturasService.obterUltimasLeituras({
      estacaoId: codigo,
      municipio,
      apenasAtivas: true,
    });
  }

  // ATENÇÃO: mantém o stub de IQAr da develop até a integração da task 35.08 (ELEM-200),
  // garantindo validação de estação ativa e pertencente ao município solicitado.
  async obterIqarPublico(params: {
    municipio: string;
    estacaoId?: string;
  }): Promise<IqarPublicoResponse> {
    const municipio = params.municipio.trim();
    const estacaoId = params.estacaoId?.trim();

    if (!municipio) {
      throw new ErroHttpPublicAnalise(404, "Estação não encontrada.");
    }

    const estacaoResult = estacaoId
      ? await pool.query<EstacaoPublicaRow>(
          `SELECT id, codigo, municipio
           FROM estacoes
           WHERE (id::text = $1 OR UPPER(codigo) = UPPER($1))
             AND UPPER(municipio) = UPPER($2)
             AND status = 'Ativa'
           LIMIT 1`,
          [estacaoId, municipio],
        )
      : await pool.query<EstacaoPublicaRow>(
          `SELECT id, codigo, municipio
           FROM estacoes
           WHERE UPPER(municipio) = UPPER($1)
             AND status = 'Ativa'
           ORDER BY codigo ASC
           LIMIT 1`,
          [municipio],
        );

    const estacao = estacaoResult.rows[0];

    if (!estacao) {
      throw new ErroHttpPublicAnalise(404, "Estação não encontrada.");
    }

    return {
      indice: 45,
      classificacao: "Boa",
      cor: "#00E400",
      municipio: estacao.municipio,
    };
  }
}
