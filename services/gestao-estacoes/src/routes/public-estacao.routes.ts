import { Router } from "express";
import * as estacaoController from "../controllers/estacao.controller";

const router = Router();

router.get("/municipios", estacaoController.listarMunicipiosPublico);
router.get("/:municipio/status", estacaoController.statusPublicoPorMunicipio);

export default router;
