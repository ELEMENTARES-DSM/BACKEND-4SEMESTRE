import { pool } from "../config/db";
import { AppError } from "../middlewares/error-handler";
import {
  Sensor,
  SensorParaSimulador,
  StatusSensor,
  TipoSensor,
} from "../models/sensor.model";

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

/**
 * Corrida entre duas gravações: a UNIQUE do banco decide. Traduz a violação
 * para a mensagem da regra que foi quebrada (um sensor por tipo por estação,
 * ou código repetido na estação); sem isso o errorHandler responderia sempre
 * com a mensagem de tipo.
 */
const traduzirViolacaoDeUnicidade = (
  err: unknown,
  dados: Pick<DadosSensor, "tipo" | "codigo">
): never => {
  const { code, constraint } = err as { code?: string; constraint?: string };

  if (code === "23505" && constraint === "uq_sensores_estacao_codigo") {
    throw new AppError(
      `Já existe um sensor com o código "${dados.codigo}" nesta estação.`,
      409
    );
  }

  if (code === "23505" && constraint === "uq_sensor_por_estacao") {
    throw new AppError(
      `Esta estação já possui um sensor de ${dados.tipo} cadastrado`,
      409
    );
  }

  throw err;
};

export const create = async (
  estacaoId: string,
  dados: DadosSensor
): Promise<Sensor> => {
  try {
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
  } catch (err) {
    return traduzirViolacaoDeUnicidade(err, dados);
  }
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

/**
 * Sensores da estação com a faixa física da grandeza e a calibração, para o
 * simulador. Sensor sem código fica de fora: não há o que a placa enviar.
 */
export const findParaSimulador = async (
  estacaoId: string
): Promise<SensorParaSimulador[]> => {
  const result = await pool.query<SensorParaSimulador>(
    `SELECT s.codigo, s.tipo, t.unidade, t.faixa_min, t.faixa_max,
            s.fator_conversao, s.offset_calibracao AS "offset", s.status
     FROM sensores s
     JOIN tipos_sensor t ON t.nome = s.tipo
     WHERE s.estacao_id = $1 AND s.codigo IS NOT NULL
     ORDER BY s.codigo`,
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

export const findByEstacaoIdECodigo = async (
  estacaoId: string,
  codigo: string,
  ignorarSensorId?: string
): Promise<Sensor | null> => {
  const result = await pool.query<Sensor>(
    `SELECT ${COLUNAS_SENSOR} FROM sensores
     WHERE estacao_id = $1 AND codigo = $2 AND id IS DISTINCT FROM $3`,
    [estacaoId, codigo, ignorarSensorId ?? null]
  );

  return result.rows[0] ?? null;
};

/**
 * O código só é gravado enquanto o sensor não tem um (COALESCE mantém o atual):
 * depois de definido ele fica fixo, porque mudar o código quebraria a
 * configuração da placa. O service já recusa a troca; isto é a rede de segurança.
 */
export const update = async (
  id: string,
  dados: DadosSensor
): Promise<Sensor | null> => {
  try {
    const result = await pool.query<Sensor>(
      `UPDATE sensores
       SET tipo = $1, unidade_medida = $2, unidade_leitura = $3,
           fator_conversao = $4, offset_calibracao = $5,
           codigo = COALESCE(codigo, $6)
       WHERE id = $7
       RETURNING ${COLUNAS_SENSOR}`,
      [
        dados.tipo,
        dados.unidadeMedida,
        dados.unidadeLeitura,
        dados.fatorConversao,
        dados.offset,
        dados.codigo ?? null,
        id,
      ]
    );

    return result.rows[0] ?? null;
  } catch (err) {
    return traduzirViolacaoDeUnicidade(err, dados);
  }
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
