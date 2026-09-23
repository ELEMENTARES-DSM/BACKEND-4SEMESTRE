/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS estacoes (
        id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo                 VARCHAR(50)   NOT NULL UNIQUE,
        nome                   VARCHAR(150)  NOT NULL,
        municipio              VARCHAR(100)  NOT NULL,
        status_administrativo  VARCHAR(20)   NOT NULL DEFAULT 'Ativa'
            CHECK (status_administrativo IN ('Ativa', 'Inativa')),
        ultimo_ping            TIMESTAMPTZ,
        criado_em              TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_estacoes_ultimo_ping ON estacoes (ultimo_ping);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_estacoes_municipio ON estacoes (municipio);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS estacoes;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
