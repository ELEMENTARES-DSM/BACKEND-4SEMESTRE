import { pool } from "../config/db";
import { Sensor, StatusSensor, TipoSensor } from "../models/sensor.model";

interface DadosSensor {
  codigo?: string;
  nome?: string;
  tipo: TipoSensor;
  unidadeMedida: string;
  unidadeLeitura: string | null;
  fatorConversao: number;
  offset: number;
}

// A coluna do banco é offset_calibracao (OFFSET é palavra reservada do
// PostgreSQL); a API e a tela usam o nome offset, por isso o alias.
const COLUNAS_SENSOR = `id, estacao_id, codigo, nome, tipo, unidade_medida,
       unidade_leitura, fator_conversao, offset_calibracao AS "offset",
       status, criado_em`;

export const create = async (
  estacaoId: string,
  dados: DadosSensor
): Promise<Sensor> => {
  const result = await pool.query<Sensor>(
    `INSERT INTO sensores (estacao_id, tipo, unidade_medida, unidade_leitura, fator_conversao, offset_calibracao, codigo, nome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${COLUNAS_SENSOR}`,
    [
      estacaoId,
      dados.tipo,
      dados.unidadeMedida,
      dados.unidadeLeitura,
      dados.fatorConversao,
      dados.offset,
      dados.codigo ?? null,
      dados.nome ?? null,
    ]
  );

  return result.rows[0];
};

export const findByEstacaoId = async (
  estacaoId: string
): Promise<Sensor[]> => {
  const result = await pool.query<Sensor>(
    `SELECT ${COLUNAS_SENSOR} FROM sensores WHERE estacao_id = $1 ORDER BY tipo`,
    [estacaoId]
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `SELECT ${COLUNAS_SENSOR} FROM sensores WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const findByEstacaoIdETipo = async (
  estacaoId: string,
  tipo: TipoSensor,
  ignorarSensorId?: string
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `SELECT ${COLUNAS_SENSOR} FROM sensores
     WHERE estacao_id = $1 AND tipo = $2 AND id IS DISTINCT FROM $3`,
    [estacaoId, tipo, ignorarSensorId ?? null]
  );

  return result.rows[0] ?? null;
};

export const update = async (
  id: string,
  dados: DadosSensor
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `UPDATE sensores
     SET tipo = $1, unidade_medida = $2, unidade_leitura = $3,
         fator_conversao = $4, offset_calibracao = $5
     WHERE id = $6
     RETURNING ${COLUNAS_SENSOR}`,
    [dados.tipo, dados.unidadeMedida, dados.unidadeLeitura, dados.fatorConversao, dados.offset, id]
  );

  return result.rows[0] ?? null;
};

export const updateStatus = async (
  id: string,
  status: StatusSensor
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `UPDATE sensores
     SET status = $1
     WHERE id = $2
     RETURNING ${COLUNAS_SENSOR}`,
    [status, id]
  );

  return result.rows[0] ?? null;
};
