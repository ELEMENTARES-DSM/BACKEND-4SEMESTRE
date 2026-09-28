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
    CREATE TABLE IF NOT EXISTS usuarios (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        nome        VARCHAR(120)  NOT NULL,
        email       VARCHAR(150)  NOT NULL UNIQUE,
        senha_hash  TEXT          NOT NULL,
        papel_id    UUID          NOT NULL REFERENCES papeis(id) ON DELETE RESTRICT,
        municipio   VARCHAR(100),
        esta_ativo  BOOLEAN       NOT NULL DEFAULT TRUE,
        criado_em   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  pgm.sql(`
    COMMENT ON COLUMN usuarios.senha_hash IS
        'Hash bcryptjs (salt rounds 10). NUNCA armazenar a senha em texto claro.';
  `);

  pgm.sql(`
    COMMENT ON COLUMN usuarios.esta_ativo IS
        'Inativacao logica (soft delete). FALSE bloqueia o login sem apagar o registro.';
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_valida_municipio_gestor()
    RETURNS TRIGGER AS $$
    BEGIN
        IF NEW.municipio IS NULL AND EXISTS (
            SELECT 1 FROM papeis
            WHERE id = NEW.papel_id AND nome = 'GESTOR_PUBLICO'
        ) THEN
            RAISE EXCEPTION 'Usuario com papel GESTOR_PUBLICO exige municipio definido.'
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`DROP TRIGGER IF EXISTS trg_valida_municipio_gestor ON usuarios;`);

  pgm.sql(`
    CREATE TRIGGER trg_valida_municipio_gestor
        BEFORE INSERT OR UPDATE ON usuarios
        FOR EACH ROW EXECUTE FUNCTION fn_valida_municipio_gestor();
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_usuarios_municipio ON usuarios (municipio);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_usuarios_ativos ON usuarios (email) WHERE esta_ativo;`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS trg_valida_municipio_gestor ON usuarios;`);
  pgm.sql(`DROP FUNCTION IF EXISTS fn_valida_municipio_gestor;`);
  pgm.sql(`DROP TABLE IF EXISTS usuarios;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
