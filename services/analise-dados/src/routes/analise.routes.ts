import { Router, Request, Response } from "express";
import { authOpcional } from "../middlewares/auth.middleware";
import { verificarPeriodo } from "../middlewares/periodo.middleware";
import { verificarMunicipio } from "../middlewares/municipio.middleware";
import { aplicarCotaEAuditar } from "../middlewares/cota.middleware";

const router = Router();

// Aplica autenticação opcional, validação de limites de período, isolamento de município e cota/auditoria
router.use(authOpcional);
router.use(verificarPeriodo);
router.use(verificarMunicipio);
router.use(aplicarCotaEAuditar);

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
  return res.send(`estacao;periodo;timestamp;valor\n1;${periodo};${new Date().toISOString()};15.5\n`);
});

export default router;
