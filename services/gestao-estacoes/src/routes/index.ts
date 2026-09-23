import { Router } from "express";
import sensorRoutes from "./sensor.routes";

const router = Router();

router.use(sensorRoutes);

export default router;
