import { pool } from "../config/db";
import { TipoSensorCatalogo } from "../models/tipo-sensor.model";
import { CreateTipoSensorDTO } from "../dto/create-tipo-sensor.dto";
import { AppError } from "../middlewares/error-handler";

const COLUNAS = "id, nome, unidade, faixa_min, faixa_max, agregacao";

export const findAll = async (): Promise<TipoSensorCatalogo[]> => {
  const result = await pool.query<TipoSensorCatalogo>(
    `SELECT ${COLUNAS}
     FROM tipos_sensor
     ORDER BY nome`
  );

  return result.rows;
};

export const findByNome = async (
  nome: string
): Promise<TipoSensorCatalogo | null> => {
  const result = await pool.query<TipoSensorCatalogo>(
    `SELECT ${COLUNAS}
     FROM tipos_sensor
     WHERE nome = $1`,
    [nome]
  );

  return result.rows[0] ?? null;
};

export const create = async (
  dados: CreateTipoSensorDTO
): Promise<TipoSensorCatalogo> => {
  try {
    const result = await pool.query<TipoSensorCatalogo>(
      `INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max, agregacao)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUNAS}`,
      [dados.nome, dados.unidade, dados.faixa_min, dados.faixa_max, dados.agregacao]
    );

    return result.rows[0];
  } catch (err) {
    // Corrida entre duas inserções do mesmo nome: a UNIQUE do banco decide.
    // Sem este tratamento o errorHandler responderia com a mensagem de sensor.
    if ((err as { code?: string }).code === "23505") {
      throw new AppError(
        `Já existe uma grandeza com o nome "${dados.nome}" no catálogo.`,
        409
      );
    }
    throw err;
  }
};
