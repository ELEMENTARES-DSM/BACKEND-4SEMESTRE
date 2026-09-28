import { Request, Response, NextFunction } from "express";
import * as papelService from "../services/papel.service";

export const findAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const papeis = await papelService.findAll();
    res.json(papeis);
  } catch (err) {
    next(err);
  }
};

export const findById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const papel = await papelService.findById(req.params.id as string);
    res.json(papel);
  } catch (err) {
    next(err);
  }
};