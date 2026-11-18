/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Task 42.02 (ELEM-272 / US-42): Adiciona coluna aceite_privacidade_em na tabela usuarios.
 * Registra o timestamp em que o munícipe aceitou o aviso de privacidade ao se cadastrar.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS aceite_privacidade_em TIMESTAMPTZ;
  `);

  pgm.sql(`
    COMMENT ON COLUMN usuarios.aceite_privacidade_em IS
        'Data e hora em que o usuario aceitou os termos e aviso de privacidade (obrigatorio para MUNICIPE).';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE usuarios
    DROP COLUMN IF EXISTS aceite_privacidade_em;
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
