import { Router } from "express";
import estacaoRoutes from "./estacao.routes";
import internalEstacaoRoutes from "./internal-estacao.routes";
import publicEstacaoRoutes from "./public-estacao.routes";
import sensorRoutes from "./sensor.routes";
import tipoSensorRoutes from "./tipo-sensor.routes";

const router = Router();

router.use("/api/v1/internal/estacoes", internalEstacaoRoutes);
router.use("/estacoes/api/v1/internal/estacoes", internalEstacaoRoutes);
router.use("/estacoes/publico", publicEstacaoRoutes);
router.use("/publico", publicEstacaoRoutes);
// Antes de estacaoRoutes: senão GET /estacoes/tipos-sensor cai em GET /estacoes/:id.
router.use("/estacoes", tipoSensorRoutes);
router.use("/estacoes", estacaoRoutes);
router.use("/estacoes", sensorRoutes);

export default router;

