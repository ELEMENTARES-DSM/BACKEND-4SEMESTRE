import { Router, Request, Response, NextFunction } from "express";
import { authOpcional, authenticate } from "../middlewares/auth.middleware";
import { verificarPeriodo } from "../middlewares/periodo.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";
import { IqarService, ErroHttpIqar } from "../services/iqar.service";

const router = Router();
const iqarService = new IqarService();

// Aplica autenticação opcional, validação de limites de período e isolamento de município
router.use(authOpcional);
router.use(verificarPeriodo);
router.use(verificarMunicipio);

function exigirAuthSePrivada(req: Request, res: Response, next: NextFunction) {
  if (req.baseUrl.startsWith("/public")) {
    return next();
  }
  return authenticate(req, res, next);
}

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

router.get(
  "/iqar",
  exigirAuthSePrivada,
  async (req: Request, res: Response) => {
    return res.status(400).json({
      statusCode: 400,
      message: "Informe o ID da estação na rota: /estacoes/:id/iqar",
    });
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
