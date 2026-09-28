/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Corrige regras_alerta: fator/ganho pertencem ao sensor, não à regra;
 * adiciona criado_em e troca o índice de esta_ativo por um índice parcial.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE regras_alerta
        DROP COLUMN IF EXISTS fator,
        DROP COLUMN IF EXISTS ganho,
        ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `);

  pgm.sql(`DROP INDEX IF EXISTS idx_regras_alerta_esta_ativo;`);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_regras_alerta_sensor_ativas
    ON regras_alerta (sensor_id) WHERE esta_ativo;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_regras_alerta_sensor_ativas;`);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_regras_alerta_esta_ativo
    ON regras_alerta (esta_ativo);
  `);

  pgm.sql(`
    ALTER TABLE regras_alerta
        DROP COLUMN IF EXISTS criado_em,
        ADD COLUMN IF NOT EXISTS fator NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ganho NUMERIC(10,2) NOT NULL DEFAULT 0;
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
