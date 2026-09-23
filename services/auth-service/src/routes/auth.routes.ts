import { Router } from "express";
import { login, logout } from "../controllers/auth.controller";
import { authMiddleware } from "../middlewares/middleware";

const router = Router();

router.post("/login", login);
router.post("/logout", authMiddleware, logout); // exige token válido pra poder revogar

export default router;