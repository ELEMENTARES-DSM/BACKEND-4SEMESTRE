/* eslint-disable no-undef */

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
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  pgm.sql(`
    CREATE TABLE IF NOT EXISTS estacoes (
        id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo        VARCHAR(30)   NOT NULL UNIQUE,
        nome          VARCHAR(120)  NOT NULL,
        municipio     VARCHAR(100)  NOT NULL,
        latitude      NUMERIC(9,6)  NOT NULL,
        longitude     NUMERIC(9,6)  NOT NULL,
        status        VARCHAR(20)   NOT NULL DEFAULT 'Ativa',
        nivel_bateria INT           DEFAULT NULL,
        ultimo_ping   TIMESTAMP     DEFAULT NULL,
        criado_em     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT chk_estacoes_latitude CHECK (latitude BETWEEN -90.000000 AND 90.000000),
        CONSTRAINT chk_estacoes_longitude CHECK (longitude BETWEEN -180.000000 AND 180.000000),
        CONSTRAINT chk_estacoes_nivel_bateria CHECK (nivel_bateria IS NULL OR (nivel_bateria BETWEEN 0 AND 100))
    );
  `);

  pgm.sql(`
    COMMENT ON COLUMN estacoes.codigo IS
        'Código alfanumérico único (UNIQUE). Imutável após criação.';
  `);

  pgm.sql(`
    COMMENT ON COLUMN estacoes.status IS
        'Situação operacional: Ativa, Inativa ou Com Falha. Padrão: Ativa.';
  `);

  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_estacoes_municipio ON estacoes (municipio);`,
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_estacoes_municipio;`);
  pgm.sql(`DROP TABLE IF EXISTS estacoes;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
