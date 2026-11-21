import { Router } from "express";
import { authMiddleware } from "../middlewares/middleware";
import { listarMedicoes } from "../controllers/medicoes.controller";

const router = Router();

router.get("/", authMiddleware, listarMedicoes);

export default router;
