import { Pool } from "pg";
import { pool } from "../config/db";
import { SensorDaEstacao } from "../models/sensor.model";

/**
 * Busca o sensor da estação pelo código, SEM filtrar por status: a TASK 18.01
 * precisa distinguir sensor inativo de sensor inexistente.
 *
 * O banco não garante código único por estação (sensores.codigo não tem UNIQUE).
 * Se houver código repetido, o ativo tem preferência.
 */
export async function buscarSensorDaEstacao(
  estacaoId: string,
  codigo: string,
  db: Pick<Pool, "query"> = pool,
): Promise<SensorDaEstacao | null> {
  const resultado = await db.query<{
    id: string;
    codigo: string;
    status: SensorDaEstacao["status"];
    fator: string;
    ganho: string;
  }>(
    `SELECT id, codigo, status, fator, ganho FROM sensores
     WHERE estacao_id = $1 AND codigo = $2
     ORDER BY (status = 'Ativo') DESC
     LIMIT 1`,
    [estacaoId, codigo],
  );

  const linha = resultado.rows[0];
  if (!linha) {
    return null;
  }

  // NUMERIC volta como string do pg.
  return {
    id: linha.id,
    codigo: linha.codigo,
    status: linha.status,
    fator: Number(linha.fator),
    ganho: Number(linha.ganho),
  };
}
