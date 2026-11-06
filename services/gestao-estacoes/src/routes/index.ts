import { Router } from "express";
import estacaoRoutes from "./estacao.routes";
import internalEstacaoRoutes from "./internal-estacao.routes";
import sensorRoutes from "./sensor.routes";

const router = Router();

router.use("/api/v1/internal/estacoes", internalEstacaoRoutes);
router.use("/estacoes/api/v1/internal/estacoes", internalEstacaoRoutes);
router.use("/estacoes", estacaoRoutes);
router.use("/estacoes", sensorRoutes);

export default router;

