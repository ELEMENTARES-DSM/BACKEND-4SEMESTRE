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
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS regras_alerta (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        sensor_id   UUID          NOT NULL REFERENCES sensores(id) ON DELETE RESTRICT,
        nome        VARCHAR(100)  NOT NULL,
        operador    VARCHAR(5)    NOT NULL,
        valor_limite NUMERIC(10,2) NOT NULL,
        severidade  VARCHAR(20)   NOT NULL,
        fator       NUMERIC(10,2) NOT NULL,
        ganho       NUMERIC(10,2) NOT NULL,
        esta_ativo  BOOLEAN       NOT NULL DEFAULT TRUE,

        CONSTRAINT chk_regras_alerta_operador
            CHECK (operador IN ('>', '>=', '<', '<=', '=')),

        CONSTRAINT chk_regras_alerta_severidade
            CHECK (severidade IN ('ATENCAO', 'ALERTA', 'CRITICO'))
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_regras_alerta_sensor_id
    ON regras_alerta (sensor_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_regras_alerta_esta_ativo
    ON regras_alerta (esta_ativo);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS regras_alerta;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
