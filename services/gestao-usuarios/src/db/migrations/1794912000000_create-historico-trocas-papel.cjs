/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Task 42.03 (ELEM-273 / US-42): Cria a tabela historico_trocas_papel.
 * Registra cada alteração de papel realizada pelo Administrador,
 * armazenando quem foi alterado, qual era o papel anterior, o novo papel,
 * quem executou a troca e a data/hora.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS historico_trocas_papel (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id        UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        papel_anterior_id UUID        NOT NULL REFERENCES papeis(id) ON DELETE RESTRICT,
        papel_novo_id     UUID        NOT NULL REFERENCES papeis(id) ON DELETE RESTRICT,
        alterado_por      UUID        NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE historico_trocas_papel IS
        'Auditoria das trocas de perfil/papel de usuarios realizadas por administradores.';
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_historico_trocas_papel_usuario
        ON historico_trocas_papel (usuario_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_historico_trocas_papel_criado_em
        ON historico_trocas_papel (criado_em DESC);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS historico_trocas_papel CASCADE;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
