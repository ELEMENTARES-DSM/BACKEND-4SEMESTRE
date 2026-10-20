/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS medidas (
      id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      sensor_id   UUID          NOT NULL REFERENCES sensores(id) ON DELETE RESTRICT,
      unixtime    BIGINT        NOT NULL,
      valor_bruto NUMERIC(18,6) NOT NULL,
      valor       NUMERIC(12,6) NOT NULL,
      valida      BOOLEAN       NOT NULL DEFAULT TRUE,
      staging_id  UUID          NOT NULL,
      criado_em   TIMESTAMP     NOT NULL,

      CONSTRAINT uq_medidas_sensor_unixtime UNIQUE (sensor_id, unixtime)
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_medidas_sensor_id
      ON medidas (sensor_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_medidas_unixtime
      ON medidas (unixtime);
  `);
};

/**
 * Regra de negócio: a tabela medidas nunca deve ser apagada.
 *
 * @returns {Promise<void> | void}
 */
const down = () => {
  // Intencionalmente vazio: a tabela medidas nunca deve ser removida.
};

/* global module */
module.exports = {
  shorthands,
  up,
  down,
};
