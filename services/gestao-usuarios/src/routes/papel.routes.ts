import { Router } from "express";
import * as papelController from "../controllers/papel.controller";
import { validate } from "../middlewares/validate";
import { userIdParamSchema as papelIdParamSchema } from "../validations/user.validation";

const router = Router();

router.get("/", papelController.findAll);
router.get("/:id", validate(papelIdParamSchema, "params"), papelController.findById);

export default router;