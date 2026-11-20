import { Router, Request, Response, NextFunction } from "express";
import { authOpcional, authenticate } from "../middlewares/auth.middleware";
import { verificarPeriodo } from "../middlewares/periodo.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";
import { aplicarCotaEAuditar } from "../middlewares/cota.middleware";
import {
  UltimasLeiturasService,
  ErroHttpUltimasLeituras,
} from "../services/ultimas-leituras.service";
import { IqarService, ErroHttpIqar } from "../services/iqar.service";
import { z } from "zod";
import {
  ErroHttpSeries,
  obterSeriesHistoricas,
  PeriodoSeries,
} from "../services/series.service";

const router = Router();
const ultimasLeiturasService = new UltimasLeiturasService();
const iqarService = new IqarService();

// Aplica autenticação opcional, validação de limites de período, isolamento de município e cota/auditoria
router.use(authOpcional);
router.use(verificarPeriodo);
router.use(verificarMunicipio);
router.use(aplicarCotaEAuditar);

function exigirAuthSePrivada(req: Request, res: Response, next: NextFunction) {
  if (req.baseUrl.startsWith("/public")) {
    return next();
  }
  return authenticate(req, res, next);
}
const querySeriesSchema = z.object({
  grandeza: z
    .string({ error: "Parâmetro 'grandeza' é obrigatório." })
    .trim()
    .min(1, "Parâmetro 'grandeza' é obrigatório."),
  periodo: z.enum(["24h", "7d", "30d"], {
    error: "Parâmetro 'periodo' inválido. Valores aceitos: 24h, 7d, 30d.",
  }),
});

router.get("/estacoes/:id/series", async (req: Request, res: Response) => {
    try {
      const validacaoQuery = querySeriesSchema.safeParse(req.query);
      if (!validacaoQuery.success) {
        return res.status(400).json({
          statusCode: 400,
          message:
            validacaoQuery.error.issues[0]?.message ?? "Parâmetros inválidos.",
        });
      }

      const id = String(req.params.id);
      const { grandeza, periodo } = validacaoQuery.data;

      const resultado = await obterSeriesHistoricas({
        estacaoId: id,
        grandeza,
        periodo: periodo as PeriodoSeries,
        usuario: req.auth,
      });

      return res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ErroHttpSeries) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }

      console.error("Erro ao consultar séries históricas:", error);
      return res.status(500).json({
        statusCode: 500,
        message: "Internal Server Error",
      });
    }
  },
);

router.get(
  "/estacoes/:id/ultimas-leituras",
  exigirAuthSePrivada,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);

      const resultado = await ultimasLeiturasService.obterUltimasLeituras({
        estacaoId: id,
        usuario: req.auth,
      });

      return res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ErroHttpUltimasLeituras) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }

      console.error("Erro ao consultar últimas leituras:", error);
      return res.status(500).json({
        statusCode: 500,
        message: "Internal Server Error",
      });
    }
  },
);

// GET /analise/estacoes/:id/iqar (US-35 / ELEM-200)
router.get(
  "/estacoes/:id/iqar",
  exigirAuthSePrivada,
  async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);

      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId: id,
        usuario: req.auth,
      });

      return res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ErroHttpIqar) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }

      console.error("Erro ao calcular o IQAr da estação:", error);
      return res.status(500).json({
        statusCode: 500,
        message: "Internal Server Error",
      });
    }
  },
);

// GET /analise/iqar (aceita ?estacaoId=... ou orienta o uso de /estacoes/:id/iqar)
router.get(
  "/iqar",
  exigirAuthSePrivada,
  async (req: Request, res: Response) => {
    const estacaoId =
      typeof req.query.estacaoId === "string" ? req.query.estacaoId.trim() : "";

    if (!estacaoId) {
      return res.status(400).json({
        statusCode: 400,
        message: "Informe o ID da estação na rota: /estacoes/:id/iqar",
      });
    }

    try {
      const resultado = await iqarService.calcularIqarPorEstacao({
        estacaoId,
        usuario: req.auth,
      });
      return res.status(200).json(resultado);
    } catch (error) {
      if (error instanceof ErroHttpIqar) {
        return res.status(error.statusCode).json({
          statusCode: error.statusCode,
          message: error.message,
        });
      }

      console.error("Erro ao calcular o IQAr da estação:", error);
      return res.status(500).json({
        statusCode: 500,
        message: "Internal Server Error",
      });
    }
  },
);

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
