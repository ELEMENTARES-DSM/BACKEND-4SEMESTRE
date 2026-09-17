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
    CREATE TABLE IF NOT EXISTS papeis (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        nome        VARCHAR(50)  NOT NULL UNIQUE,
        descricao   VARCHAR(200),
        criado_em   TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  pgm.sql(`
    COMMENT ON TABLE papeis IS
        'Perfis canonicos de acesso: ADMINISTRADOR, GESTOR_PUBLICO e PESQUISADOR.';
  `);

  pgm.sql(`
    INSERT INTO papeis (nome, descricao) VALUES
        ('ADMINISTRADOR',  'Gestao irrestrita e global da plataforma.'),
        ('GESTOR_PUBLICO', 'Operacao e monitoramento restritos ao proprio municipio.'),
        ('PESQUISADOR',    'Acesso somente de consulta a series historicas.')
    ON CONFLICT (nome) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS papeis;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
