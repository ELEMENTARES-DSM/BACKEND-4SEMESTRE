/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Staging das mensagens recebidas (US-13 / TASK 13.01).
 *
 * Versão mínima: só o necessário para detectar mensagem duplicada por estação
 * e timestamp. Outras tasks (ex.: US-14) podem adicionar colunas e status com
 * migrations novas.
 *
 * Sem FK para estacoes: a existência/atividade da estação é validada em outra
 * etapa, e FK entre serviços acopla a ordem das migrations.
 * Sem CHECK em status: a US-14 vai definir os demais status.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS mensagens_staging (
        id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        estacao_uuid       UUID          NOT NULL,
        unixtime           BIGINT        NOT NULL,
        timestamp_leitura  TIMESTAMPTZ   NOT NULL,
        payload            JSONB         NOT NULL,
        status             VARCHAR(20)   NOT NULL DEFAULT 'recebida',
        recebido_em        TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Garante a deduplicação: uma única mensagem não rejeitada por (estação, segundo).
  // O predicado precisa ser repetido no ON CONFLICT do repository.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_staging_estacao_unixtime
    ON mensagens_staging (estacao_uuid, unixtime) WHERE status <> 'rejeitada';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS mensagens_staging;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
