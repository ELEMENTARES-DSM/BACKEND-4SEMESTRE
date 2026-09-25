import { Router } from "express";
import estacaoRoutes from "./estacao.routes";
import sensorRoutes from "./sensor.routes";

const router = Router();

router.use("/estacoes", estacaoRoutes);
router.use("/estacoes", sensorRoutes);

export default router;
