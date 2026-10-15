import { Pool } from "pg";
import { pool } from "../config/db";
import { PayloadLeituraValidado } from "../dto/mensagem-ingestao.dto";

export interface NovaMensagemStaging {
  estacaoId: string;
  unixtime: number;
  timestampLeitura: Date;
  payload: PayloadLeituraValidado;
}

export type ExecutorQuery = Pick<Pool, "query">;

/**
 * Grava a mensagem na staging se ainda não existir uma com a mesma estação e unixtime.
 * Retorna o id quando gravou (mensagem nova) e null quando não gravou (duplicata).
 *
 * Um único comando atômico: conferir com SELECT antes deixaria duas cópias
 * simultâneas passarem juntas. O WHERE do ON CONFLICT é obrigatório porque o
 * índice é parcial e precisa repetir o predicado dele ('rejeitada' = STATUS_REJEITADA).
 */
export async function inserirSeNova(
  { estacaoId, unixtime, timestampLeitura, payload }: NovaMensagemStaging,
  db: ExecutorQuery = pool,
): Promise<string | null> {
  const resultado = await db.query<{ id: string }>(
    `INSERT INTO mensagens_staging (estacao_uuid, unixtime, timestamp_leitura, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (estacao_uuid, unixtime) WHERE status <> 'rejeitada' DO NOTHING
     RETURNING id`,
    [estacaoId, unixtime, timestampLeitura, JSON.stringify(payload)],
  );

  return resultado.rows[0]?.id ?? null;
}

/**
 * Desfaz a reserva feita por inserirSeNova. Só remove se a linha ainda está
 * 'recebida' (STATUS_RECEBIDA), ou seja, se não avançou de status.
 */
export async function removerReserva(
  stagingId: string,
  db: ExecutorQuery = pool,
): Promise<void> {
  await db.query(
    `DELETE FROM mensagens_staging WHERE id = $1 AND status = 'recebida'`,
    [stagingId],
  );
}
