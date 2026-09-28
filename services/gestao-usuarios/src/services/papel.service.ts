import * as papelRepository from "../repositories/papel.repository";
import { Papel } from "../models/papel.model";
import { AppError } from "../middlewares/error-handler";

export const findAll = async (): Promise<Papel[]> => {
  return papelRepository.findAll();
};

export const findById = async (id: string): Promise<Papel> => {
  const papel = await papelRepository.findById(id);
  if (!papel) {
    throw new AppError("Papel não encontrado", 404);
  }
  return papel;
};