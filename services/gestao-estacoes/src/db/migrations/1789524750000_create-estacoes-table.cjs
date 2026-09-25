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
        id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        codigo         VARCHAR(30)   NOT NULL UNIQUE,
        nome           VARCHAR(120)  NOT NULL,
        municipio      VARCHAR(100)  NOT NULL,
        latitude       NUMERIC(9,6)  NOT NULL,
        longitude      NUMERIC(9,6)  NOT NULL,
        status         VARCHAR(20)   NOT NULL DEFAULT 'Ativa',
        nivel_bateria  INT,
        ultimo_ping    TIMESTAMPTZ,
        criado_em      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT chk_latitude_valida  CHECK (latitude  BETWEEN -90  AND 90),
        CONSTRAINT chk_longitude_valida CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT chk_status_estacao   CHECK (status IN ('Ativa', 'Inativa', 'Com Falha')),
        CONSTRAINT chk_bateria_valida   CHECK (nivel_bateria IS NULL
                                               OR nivel_bateria BETWEEN 0 AND 100)
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_estacoes_municipio   ON estacoes (municipio);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_estacoes_ultimo_ping ON estacoes (ultimo_ping);`);
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
