import { Router, Request, Response, NextFunction } from "express";
import { authOpcional, authenticate } from "../middlewares/auth.middleware";
import { verificarPeriodo } from "../middlewares/periodo.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";
import { aplicarCotaEAuditar } from "../middlewares/cota.middleware";
import {
  UltimasLeiturasService,
  ErroHttpUltimasLeituras,
} from "../services/ultimas-leituras.service";

const router = Router();
const ultimasLeiturasService = new UltimasLeiturasService();

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
