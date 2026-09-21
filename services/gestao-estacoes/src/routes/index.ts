import { Router } from "express";
import estacaoRoutes from "./estacao.routes";

const router = Router();

router.use("/estacoes", estacaoRoutes);

export default router;