import { Router } from "express";
import { authMiddleware, checkRole } from "../middlewares/middleware";
import { reenviarDlq } from "../controllers/reenvio-dlq.controller";

const router = Router();

router.post("/reenviar", authMiddleware, checkRole(["ADMINISTRADOR"]), reenviarDlq);

export default router;
