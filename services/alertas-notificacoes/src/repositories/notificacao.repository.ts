import { Pool, PoolClient } from "pg";
import { pool } from "../config/db";
import { CanalNotificacao, Notificacao } from "../models/notificacao.model";

// Pool ou o cliente de uma transação.
export type DbQueryable = Pick<Pool | PoolClient, "query">;

interface DadosNotificacao {
  alarmeId: string;
  destinatarioId: string;
  canal: CanalNotificacao;
}

/**
 * Registra o aviso pendente do alarme para o destinatário no canal, ou devolve o
 * que já existe: o mesmo evento entregue de novo não cria aviso novo (US-23).
 */
export const findOrCreatePendente = async (
  dados: DadosNotificacao,
  db: DbQueryable = pool
): Promise<Notificacao> => {
  const insercao = await db.query<Notificacao>(
    `INSERT INTO notificacoes (alarme_id, destinatario_id, canal)
     VALUES ($1, $2, $3)
     ON CONFLICT (alarme_id, destinatario_id, canal) DO NOTHING
     RETURNING *`,
    [dados.alarmeId, dados.destinatarioId, dados.canal]
  );

  if (insercao.rows[0]) {
    return insercao.rows[0];
  }

  const existente = await db.query<Notificacao>(
    `SELECT * FROM notificacoes
     WHERE alarme_id = $1 AND destinatario_id = $2 AND canal = $3`,
    [dados.alarmeId, dados.destinatarioId, dados.canal]
  );

  return existente.rows[0];
};

/** Conta a tentativa que funcionou e marca o aviso como enviado. */
export const registrarEnvio = async (
  id: string,
  enviadoEm: Date,
  db: DbQueryable = pool
): Promise<Notificacao | null> => {
  const result = await db.query<Notificacao>(
    `UPDATE notificacoes
     SET situacao = 'enviado', tentativas = tentativas + 1, enviado_em = $2
     WHERE id = $1 AND situacao <> 'enviado'
     RETURNING *`,
    [id, enviadoEm]
  );

  return result.rows[0] ?? null;
};

/**
 * Conta a tentativa que falhou e guarda o erro. Com `esgotou`, o aviso passa a
 * falhou; sem, continua pendente para a próxima tentativa.
 */
export const registrarFalha = async (
  id: string,
  erro: string,
  esgotou: boolean,
  db: DbQueryable = pool
): Promise<Notificacao | null> => {
  const result = await db.query<Notificacao>(
    `UPDATE notificacoes
     SET tentativas = tentativas + 1,
         ultimo_erro = $2,
         situacao = CASE WHEN $3::boolean THEN 'falhou' ELSE 'pendente' END
     WHERE id = $1 AND situacao <> 'enviado'
     RETURNING *`,
    [id, erro, esgotou]
  );

  return result.rows[0] ?? null;
};

export const findByAlarme = async (
  alarmeId: string,
  db: DbQueryable = pool
): Promise<Notificacao[]> => {
  const result = await db.query<Notificacao>(
    `SELECT * FROM notificacoes WHERE alarme_id = $1 ORDER BY criado_em, id`,
    [alarmeId]
  );

  return result.rows;
};
