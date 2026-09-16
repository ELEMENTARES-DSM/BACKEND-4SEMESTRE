import { Router } from "express";
import userRoutes from "./user.routes";

const router = Router();

router.use("/usuarios", userRoutes);

export default router;