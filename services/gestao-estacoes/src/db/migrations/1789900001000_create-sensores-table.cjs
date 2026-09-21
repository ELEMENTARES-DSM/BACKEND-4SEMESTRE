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
        id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        estacao_id     UUID          NOT NULL REFERENCES estacoes(id) ON DELETE CASCADE,
        codigo         VARCHAR(50)   NOT NULL,
        nome           VARCHAR(150)  NOT NULL,
        grandeza       VARCHAR(100)  NOT NULL,
        unidade        VARCHAR(20)   NOT NULL,
        status         VARCHAR(20)   NOT NULL DEFAULT 'Ativo'
            CHECK (status IN ('Ativo', 'Inativo')),
        criado_em      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT uq_sensores_estacao_codigo UNIQUE (estacao_id, codigo)
    );
  `);

  pgm.sql(`
    COMMENT ON COLUMN sensores.status IS
        'Ativo/Inativo controla se o sensor ainda coleta dados. PATCH /sensores/:id/status alterna isso sem apagar historico (RF-05, item 4).';
  `);

  pgm.sql(`
    COMMENT ON CONSTRAINT uq_sensores_estacao_codigo ON sensores IS
        'Garante codigo unico POR ESTACAO (a mesma sigla pode existir em estacoes diferentes). Violacao -> 409 (RF-05, item 2).';
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_sensores_estacao_id ON sensores (estacao_id);`);
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
