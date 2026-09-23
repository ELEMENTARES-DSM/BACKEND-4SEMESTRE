/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Seed do primeiro usuário ADMINISTRADOR, só pra destravar o primeiro login
 * (a rota POST /usuarios exige um admin autenticado, então o primeiro admin
 * precisa nascer direto no banco).
 *
 * Credenciais de teste:
 *   email: admin@exemplo.com
 *   senha: SenhaCorreta123
 *
 * O hash abaixo foi gerado offline com bcryptjs (10 rounds) para essa senha.
 * Migrations não rodam JS assíncrono em runtime, por isso o hash já vem pronto.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    INSERT INTO usuarios (nome, email, senha_hash, papel_id, municipio, esta_ativo)
    SELECT
        'Admin Teste',
        'admin@exemplo.com',
        '$2b$10$P4CezQzjmnIhdldY4gapNuuvIkUy.BOfnnJxNTG2Gv7r5kWlo1Lqa',
        p.id,
        NULL,
        TRUE
    FROM papeis p
    WHERE p.nome = 'ADMINISTRADOR'
    ON CONFLICT (email) DO NOTHING;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DELETE FROM usuarios WHERE email = 'admin@exemplo.com';`);
};

module.exports = {
  shorthands,
  up,
  down,
};
