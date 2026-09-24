import { Router } from "express";
import estacaoRoutes from "./estacao.routes";
import sensorRoutes from "./sensor.routes";

const router = Router();

router.use(estacaoRoutes);
router.use(sensorRoutes);

export default router;
