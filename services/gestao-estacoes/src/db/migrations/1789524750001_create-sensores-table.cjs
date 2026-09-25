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
    CREATE TABLE IF NOT EXISTS sensores (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        estacao_id      UUID          NOT NULL REFERENCES estacoes(id) ON DELETE RESTRICT,
        tipo            VARCHAR(50)   NOT NULL,
        unidade_medida  VARCHAR(20)   NOT NULL,
        fator           NUMERIC(12,6) NOT NULL DEFAULT 1.0,
        ganho           NUMERIC(12,6) NOT NULL DEFAULT 0.0,
        status          VARCHAR(20)   NOT NULL DEFAULT 'Ativo',
        criado_em       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT uq_sensor_por_estacao UNIQUE (estacao_id, tipo),
        CONSTRAINT chk_tipo_sensor   CHECK (tipo IN ('Temperatura', 'Umidade Relativa',
                                                     'PM2.5', 'PM10', 'Velocidade do Vento')),
        CONSTRAINT chk_status_sensor CHECK (status IN ('Ativo', 'Inativo'))
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sensores_estacao ON sensores (estacao_id);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS sensores;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
