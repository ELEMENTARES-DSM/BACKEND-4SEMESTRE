import { pool } from "../config/db";
import { TipoSensorCatalogo } from "../models/tipo-sensor.model";
import { CreateTipoSensorDTO } from "../dto/create-tipo-sensor.dto";
import { UpdateTipoSensorDTO } from "../dto/update-tipo-sensor.dto";
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

export const findById = async (
  id: string
): Promise<TipoSensorCatalogo | null> => {
  const result = await pool.query<TipoSensorCatalogo>(
    `SELECT ${COLUNAS}
     FROM tipos_sensor
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const contarSensoresDaGrandeza = async (
  nome: string
): Promise<number> => {
  const result = await pool.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM sensores WHERE tipo = $1`,
    [nome]
  );

  return result.rows[0].total;
};

// Só estas colunas podem ir no SET; os nomes vêm desta lista, nunca do cliente.
const COLUNAS_ATUALIZAVEIS = ["unidade", "faixa_min", "faixa_max", "agregacao"] as const;

/**
 * Atualiza os campos informados. Com apenasSemSensores, a troca só acontece se
 * nenhum sensor usa a grandeza, na MESMA instrução (NOT EXISTS), sem janela
 * entre conferir e gravar. Devolve null quando nenhuma linha foi afetada: a
 * grandeza não existe ou está em uso (o service distingue os dois casos).
 */
export const update = async (
  id: string,
  campos: UpdateTipoSensorDTO,
  apenasSemSensores: boolean
): Promise<TipoSensorCatalogo | null> => {
  const valores: unknown[] = [id];
  const atribuicoes: string[] = [];

  for (const coluna of COLUNAS_ATUALIZAVEIS) {
    const valor = campos[coluna];
    if (valor !== undefined) {
      valores.push(valor);
      atribuicoes.push(`${coluna} = $${valores.length}`);
    }
  }

  const semSensores = apenasSemSensores
    ? "AND NOT EXISTS (SELECT 1 FROM sensores WHERE sensores.tipo = tipos_sensor.nome)"
    : "";

  try {
    const result = await pool.query<TipoSensorCatalogo>(
      `UPDATE tipos_sensor
       SET ${atribuicoes.join(", ")}
       WHERE id = $1 ${semSensores}
       RETURNING ${COLUNAS}`,
      valores
    );

    return result.rows[0] ?? null;
  } catch (err) {
    // Duas alterações juntas, cada uma mudando um lado da faixa: o CHECK do banco decide.
    if ((err as { code?: string }).code === "23514") {
      throw new AppError("faixa_min deve ser menor que faixa_max.", 400);
    }
    throw err;
  }
};

/** Apaga a grandeza. O banco recusa (23503) se algum sensor ainda a usa. */
export const remove = async (id: string): Promise<boolean> => {
  const result = await pool.query(
    "DELETE FROM tipos_sensor WHERE id = $1",
    [id]
  );

  return (result.rowCount ?? 0) > 0;
};
