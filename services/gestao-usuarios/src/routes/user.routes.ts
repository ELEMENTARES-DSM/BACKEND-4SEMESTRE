import { Router } from "express";
import * as userController from "../controllers/user.controller";
import { validate } from "../middlewares/validate";
import { authenticate, authorize } from "../middlewares/auth";
import { cadastroRateLimiter } from "../middlewares/rate-limit";
import {
  createUserSchema,
  updateUserSchema,
  updateStatusSchema,
  userIdParamSchema,
  cadastroMunicipeSchema,
} from "../validations/user.validation";

const router = Router();

// Rota pública de cadastro do munícipe (sem JWT) com rate limit de 5 cadastros/hora por IP
router.post(
  "/cadastro",
  cadastroRateLimiter,
  validate(cadastroMunicipeSchema),
  userController.cadastrarMunicipe
);

router.use(authenticate, authorize("ADMINISTRADOR"));

router.post("/", validate(createUserSchema), userController.create);
router.get("/", userController.findAll);
router.get("/:id", validate(userIdParamSchema, "params"), userController.findById);
router.put("/:id", validate(userIdParamSchema, "params"), validate(updateUserSchema), userController.update);
router.patch("/:id/status", validate(userIdParamSchema, "params"), validate(updateStatusSchema), userController.updateStatus);
router.delete("/:id", validate(userIdParamSchema, "params"), userController.remove);


export default router;