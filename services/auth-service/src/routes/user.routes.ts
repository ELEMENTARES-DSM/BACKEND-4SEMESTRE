import { Router } from "express";
import * as userController from "../controllers/user.controller";
import { validate } from "../middlewares/validate";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from "../validations/user.validation";

const router = Router();

router.post("/", validate(createUserSchema), userController.create);
router.get("/", userController.findAll);
router.get("/:id", validate(userIdParamSchema, "params"), userController.findById);
router.put("/:id", validate(userIdParamSchema, "params"), validate(updateUserSchema), userController.update);
router.delete("/:id", validate(userIdParamSchema, "params"), userController.remove);

export default router;