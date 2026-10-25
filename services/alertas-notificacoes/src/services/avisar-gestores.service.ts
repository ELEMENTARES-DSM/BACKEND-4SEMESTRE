import { Pool } from "pg";
import { pool } from "../config/db";
import { CanalNotificacao, GestorAtivo, Notificacao } from "../models/notificacao.model";
import { findGestoresAtivosDoMunicipio } from "../repositories/gestor.repository";
import { findOrCreatePendente } from "../repositories/notificacao.repository";
import { EventoAlarmeDisparado } from "../validations/evento-alarme.validation";
import logger from "../utils/logger";

export const CANAL_AVISO: CanalNotificacao = "email";

export interface AvisoRegistrado {
  notificacao: Notificacao;
  gestor: GestorAtivo;
}

export interface OpcoesAvisarGestores {
  dbPool?: Pick<Pool, "connect">;
}

/**
 * US-23 (TASK 23.02): registra, numa transação, um aviso por gestor ativo do
 * município da estação. O evento entregue de novo encontra os avisos que já
 * existem e não cria outros.
 */
export const registrarAvisos = async (
  evento: EventoAlarmeDisparado,
  opcoes: OpcoesAvisarGestores = {}
): Promise<AvisoRegistrado[]> => {
  const client = await (opcoes.dbPool ?? pool).connect();

  // Sem ouvinte de "error", a conexão que cai no meio da transação derrubaria o
  // processo; a falha já chega pela Promise da consulta.
  let conexaoPerdida: Error | undefined;
  const aoPerderConexao = (erro: Error): void => {
    conexaoPerdida = erro;
    logger.error("Conexão com o PostgreSQL perdida ao registrar avisos", {
      alarme_id: evento.alarme_id,
      erro: erro.message,
    });
  };
  client.on("error", aoPerderConexao);

  try {
    await client.query("BEGIN");
    const gestores = await findGestoresAtivosDoMunicipio(evento.municipio, client);
    const avisos: AvisoRegistrado[] = [];
    for (const gestor of gestores) {
      const notificacao = await findOrCreatePendente(
        { alarmeId: evento.alarme_id, destinatarioId: gestor.id, canal: CANAL_AVISO },
        client
      );
      avisos.push({ notificacao, gestor });
    }
    await client.query("COMMIT");

    if (gestores.length === 0) {
      logger.warn("Alarme sem gestor ativo no município; nenhum aviso registrado", {
        alarme_id: evento.alarme_id,
        municipio: evento.municipio,
      });
    }

    return avisos;
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    client.removeListener("error", aoPerderConexao);
    client.release(conexaoPerdida);
  }
};
