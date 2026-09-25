import { Router } from "express";
import regraAlertaRoutes from "./regra-alerta.routes";

const router = Router();

// O nginx encaminha /alertas/* preservando o path.
router.use("/alertas/regras-alerta", regraAlertaRoutes);

export default router;
