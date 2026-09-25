import { pool } from "../config/db";
import {
  OperadorRegraAlerta,
  RegraAlerta,
  RegraAlertaDetalhada,
  SensorComEstacao,
  SeveridadeRegraAlerta,
} from "../models/regra-alerta.model";

interface DadosRegraAlerta {
  sensorId: string;
  nome: string;
  operador: OperadorRegraAlerta;
  valorLimite: number;
  severidade: SeveridadeRegraAlerta;
}

export const findSensorComEstacao = async (
  sensorId: string
): Promise<SensorComEstacao | null> => {
  const result = await pool.query<SensorComEstacao>(
    `SELECT s.id, s.tipo, s.unidade_medida, s.status, s.estacao_id, e.municipio
     FROM sensores s
     JOIN estacoes e ON e.id = s.estacao_id
     WHERE s.id = $1`,
    [sensorId]
  );

  return result.rows[0] ?? null;
};

export const create = async (
  dados: DadosRegraAlerta
): Promise<RegraAlerta> => {
  const result = await pool.query<RegraAlerta>(
    `INSERT INTO regras_alerta (sensor_id, nome, operador, valor_limite, severidade, esta_ativo)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING *`,
    [
      dados.sensorId,
      dados.nome,
      dados.operador,
      dados.valorLimite,
      dados.severidade,
    ]
  );

  return result.rows[0];
};

// municipio = null lista todas as regras (acesso global).
export const findAllDetalhadas = async (
  municipio: string | null
): Promise<RegraAlertaDetalhada[]> => {
  const result = await pool.query<RegraAlertaDetalhada>(
    `SELECT r.id, r.sensor_id, r.nome, r.operador, r.valor_limite, r.severidade,
            r.esta_ativo, r.criado_em,
            s.tipo           AS sensor_tipo,
            s.unidade_medida AS sensor_unidade_medida,
            e.id             AS estacao_id,
            e.codigo         AS estacao_codigo,
            e.nome           AS estacao_nome,
            e.municipio
     FROM regras_alerta r
     JOIN sensores s ON s.id = r.sensor_id
     JOIN estacoes e ON e.id = s.estacao_id
     WHERE ($1::text IS NULL OR e.municipio = $1)
     ORDER BY r.criado_em DESC`,
    [municipio]
  );

  return result.rows;
};

export const findByIdComMunicipio = async (
  id: string
): Promise<(RegraAlerta & { municipio: string }) | null> => {
  const result = await pool.query<RegraAlerta & { municipio: string }>(
    `SELECT r.*, e.municipio
     FROM regras_alerta r
     JOIN sensores s ON s.id = r.sensor_id
     JOIN estacoes e ON e.id = s.estacao_id
     WHERE r.id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
};

export const updateStatus = async (
  id: string,
  estaAtivo: boolean
): Promise<RegraAlerta | null> => {
  const result = await pool.query<RegraAlerta>(
    `UPDATE regras_alerta
     SET esta_ativo = $1
     WHERE id = $2
     RETURNING *`,
    [estaAtivo, id]
  );

  return result.rows[0] ?? null;
};
