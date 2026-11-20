import { Router, Request, Response } from "express";
import { pool } from "../config/db";
import { authOpcional } from "../middlewares/auth.middleware";
import { verificarPeriodo } from "../middlewares/periodo.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";
import { aplicarCotaEAuditar } from "../middlewares/cota.middleware";
import {
  obterSeriesHistoricas,
  PeriodoSeries,
  ErroHttpSeries,
} from "../services/series.service";
import { UltimasLeiturasService } from "../services/ultimas-leituras.service";
import { IqarService } from "../services/iqar.service";
import { z } from "zod";

const router = Router();
const ultimasLeiturasService = new UltimasLeiturasService();
const iqarService = new IqarService();

const querySeriesSchema = z.object({
  grandeza: z.string().trim().min(1, "Parâmetro 'grandeza' é obrigatório."),
  periodo: z.enum(["24h", "7d", "30d"], {
    error: "Parâmetro 'periodo' inválido. Valores aceitos: 24h, 7d, 30d.",
  }),
});

router.get("/publico/:municipio/iqar", async (req: Request, res: Response) => {
  try {
    const municipio = String(req.params.municipio);
    let estacaoId = req.query.estacaoId
      ? String(req.query.estacaoId)
      : undefined;

    if (!estacaoId) {
      const estacaoRes = await pool.query(
        `SELECT id FROM estacoes WHERE UPPER(municipio) = UPPER($1) LIMIT 1`,
        [municipio],
      );
      if (estacaoRes.rows.length === 0) {
        return res.status(404).json({
          statusCode: 404,
          message: "Estação não encontrada para este município.",
        });
      }
      estacaoId = estacaoRes.rows[0].id;
    }

    const resultado = await iqarService.calcularIqarPorEstacao({
      estacaoId: estacaoId as string,
    });
    return res.status(200).json(resultado);
  } catch (error: unknown) {
    if (error instanceof ErroHttpSeries) {
      return res.status(error.statusCode).json({
        statusCode: error.statusCode,
        message: error.message,
      });
    }
    return res
      .status(500)
      .json({ statusCode: 500, message: "Internal Server Error" });
  }
});

router.get(
  "/publico/:municipio/estacoes/:codigo/series",
  async (req: Request, res: Response) => {
    try {
      const validacaoQuery = querySeriesSchema.safeParse(req.query);
      if (!validacaoQuery.success) {
        return res.status(400).json({
          statusCode: 400,
          message:
            validacaoQuery.error.issues[0]?.message ?? "Parâmetros inválidos.",
        });
      }

      const municipio = String(req.params.municipio);
      const codigo = String(req.params.codigo);
      const { grandeza, periodo } = validacaoQuery.data;

      const estacaoRes = await pool.query(
        `SELECT id, municipio FROM estacoes WHERE (id::text = $1 OR UPPER(codigo) = UPPER($1)) AND UPPER(municipio) = UPPER($2) LIMIT 1`,
        [codigo, municipio],
      );
      if (estacaoRes.rows.length === 0) {
        return res
          .status(404)
          .json({ statusCode: 404, message: "Estação não encontrada." });
      }

      if (periodo === "30d") {
        return res.status(400).json({
          statusCode: 400,
          message:
            "Período solicitado (30 dias) excede o limite permitido para acesso público. Período máximo permitido: 7 dias.",
        });
      }

      const resultado = await obterSeriesHistoricas({
        estacaoId: estacaoRes.rows[0].id,
        grandeza: String(grandeza),
        periodo: periodo as PeriodoSeries,
      });

      return res.status(200).json(resultado);
    } catch (error: unknown) {
      if (error instanceof ErroHttpSeries) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }
      return res
        .status(500)
        .json({ statusCode: 500, message: "Internal Server Error" });
    }
  },
);

router.get(
  "/publico/:municipio/estacoes/:codigo/ultimas-leituras",
  async (req: Request, res: Response) => {
    try {
      const municipio = String(req.params.municipio);
      const codigo = String(req.params.codigo);

      const estacaoRes = await pool.query(
        `SELECT id, municipio FROM estacoes WHERE (id::text = $1 OR UPPER(codigo) = UPPER($1)) AND UPPER(municipio) = UPPER($2) LIMIT 1`,
        [codigo, municipio],
      );
      if (estacaoRes.rows.length === 0) {
        return res
          .status(404)
          .json({ statusCode: 404, message: "Estação não encontrada." });
      }

      const resultado = await ultimasLeiturasService.obterUltimasLeituras({
        estacaoId: estacaoRes.rows[0].id,
      });

      return res.status(200).json(resultado);
    } catch (error: unknown) {
      const err = error as Error;

      if (error instanceof ErroHttpSeries) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }
      return res.status(500).json({
        statusCode: 500,
        message: err.message || "Internal Server Error",
      });
    }
  },
);

// Aplica autenticação opcional, validação de limites de período, isolamento de município e cota/auditoria
router.use(authOpcional);
router.use(verificarPeriodo);
router.use(verificarMunicipio);
router.use(aplicarCotaEAuditar);

// ATENÇÃO: as rotas abaixo devolvem dados FIXOS (stub) da ELEM-274.
// O dado real vem das tasks 35.06 (séries, ELEM-198), 35.07 (últimas leituras, ELEM-199),
// 35.08 (IQAr, ELEM-200) e 35.09 (rotas públicas, ELEM-201) da US-35.
// O CSV (/exportar/csv) é da task 31.03 (ELEM-171), que ainda não existe na develop.
// Não usar em produção até essas tasks serem entregues.

// GET /analise/estacoes/:id/series e GET /public/analise/estacoes/:id/series
router.get("/estacoes/:id/series", (req: Request, res: Response) => {
  const { id } = req.params;
  const { grandeza = "PM25", periodo = "24h" } = req.query;

  return res.json({
    estacao_id: id,
    grandeza,
    periodo,
    usuario_papel: req.auth?.papel || "ANONIMO",
    pontos: [
      {
        timestamp: new Date().toISOString(),
        valor: 15.5,
      },
    ],
  });
});

// GET /analise/estacoes/:id/ultimas-leituras
router.get("/estacoes/:id/ultimas-leituras", (req: Request, res: Response) => {
  const { id } = req.params;

  return res.json({
    estacao_id: id,
    leituras: [
      {
        grandeza: "PM25",
        valor: 12.4,
        unidade: "µg/m³",
        tempo_relativo: "há 2 minutos",
      },
    ],
  });
});

// GET /analise/iqar
router.get("/iqar", (req: Request, res: Response) => {
  return res.json({
    indice: 45,
    classificacao: "Boa",
    cor: "#00E400",
    municipio: req.municipioEscopo || "Geral",
  });
});

// GET /analise/exportar/csv (ou rota de CSV da 31.03)
router.get("/exportar/csv", (req: Request, res: Response) => {
  const { periodo = "24h" } = req.query;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="dados.csv"');
  return res.send(
    `estacao;periodo;timestamp;valor\n1;${periodo};${new Date().toISOString()};15.5\n`,
  );
});

export default router;
