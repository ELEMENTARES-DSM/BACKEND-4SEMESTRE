import { PoolClient } from "pg";
import { logger } from "./logger";

/**
 * Cliente retirado do pool fica sem ouvinte de "error": se a conexão com o
 * PostgreSQL cair enquanto ele está em uso, o evento sem ouvinte derruba o
 * processo (TASK 14.03). A falha já chega pela Promise da consulta; aqui ela
 * só é registrada. Retorna a função que libera o cliente: com a conexão
 * perdida, ele é descartado em vez de voltar para o pool.
 */
export function protegerCliente(client: PoolClient, contexto: string): () => void {
  let conexaoPerdida: Error | undefined;
  const aoPerderConexao = (erro: Error): void => {
    conexaoPerdida = erro;
    logger.error("Conexão com o PostgreSQL perdida", { contexto, erro: erro.message });
  };
  client.on("error", aoPerderConexao);

  return () => {
    client.removeListener("error", aoPerderConexao);
    client.release(conexaoPerdida);
  };
}
