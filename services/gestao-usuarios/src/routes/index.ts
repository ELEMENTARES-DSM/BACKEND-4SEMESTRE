import { Router } from "express";
import userRoutes from "./user.routes";
import papelRoutes from "./papel.routes";

const router = Router();

router.use("/usuarios/papeis", papelRoutes);
router.use("/usuarios", userRoutes);

export default router;