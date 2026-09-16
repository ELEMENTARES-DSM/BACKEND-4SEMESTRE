import { Request, Response, NextFunction } from "express";
import * as userService from "../services/user.service";

export const create = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usuario = await userService.create(req.body);
    res.status(201).json(usuario);
  } catch (err) {
    next(err);
  }
};

export const findAll = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const usuarios = await userService.findAll();
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
};

export const findById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usuario = await userService.findById(req.params.id as string);
    res.json(usuario);
  } catch (err) {
    next(err);
  }
};

export const update = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const usuario = await userService.update(req.params.id as string, req.body);
    res.json(usuario);
  } catch (err) {
    next(err);
  }
};

export const remove = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await userService.remove(req.params.id as string);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};