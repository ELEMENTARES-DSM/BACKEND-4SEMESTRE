import { Router } from "express";
import regraAlertaRoutes from "./regra-alerta.routes";
import alarmeRoutes from "./alarme.routes";

const router = Router();

// O nginx encaminha /alertas/* preservando o path.
router.use("/alertas/regras-alerta", regraAlertaRoutes);
router.use("/alertas/alarmes", alarmeRoutes);

export default router;
