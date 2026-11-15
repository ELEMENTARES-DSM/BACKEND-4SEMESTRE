/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * Task 42.01 (ELEM-192 / US-42): Cria o papel MUNICIPE na tabela papeis,
 * substituindo o papel legado PESQUISADOR.
 *
 * Estratégia de transição:
 * 1. Se PESQUISADOR existe e MUNICIPE ainda não existe:
 *    Renomeia PESQUISADOR para MUNICIPE preservando o UUID (id) e as chaves estrangeiras.
 * 2. Se ambos já existem:
 *    Migra eventuais usuários de PESQUISADOR para MUNICIPE e remove PESQUISADOR.
 * 3. Se nenhum existir (ou apenas MUNICIPE):
 *    Garante a presença de MUNICIPE de forma idempotente e garante a ausência de PESQUISADOR.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
        v_pesquisador_id UUID;
        v_municipe_id UUID;
    BEGIN
        SELECT id INTO v_pesquisador_id FROM papeis WHERE nome = 'PESQUISADOR';
        SELECT id INTO v_municipe_id FROM papeis WHERE nome = 'MUNICIPE';

        -- Caso 1: PESQUISADOR existe e MUNICIPE ainda não existe -> UPDATE in-place preservando o UUID
        IF v_pesquisador_id IS NOT NULL AND v_municipe_id IS NULL THEN
            UPDATE papeis
            SET nome = 'MUNICIPE',
                descricao = 'Cidadao com conta propria para acompanhamento e alertas personalizados.'
            WHERE id = v_pesquisador_id;

        -- Caso 2: Ambos existem no banco -> migra usuários vinculados e deleta PESQUISADOR
        ELSIF v_pesquisador_id IS NOT NULL AND v_municipe_id IS NOT NULL THEN
            UPDATE usuarios
            SET papel_id = v_municipe_id
            WHERE papel_id = v_pesquisador_id;

            DELETE FROM papeis WHERE id = v_pesquisador_id;

        -- Caso 3: Apenas MUNICIPE precisa ser criado (banco onde PESQUISADOR não foi inserido)
        ELSIF v_pesquisador_id IS NULL AND v_municipe_id IS NULL THEN
            INSERT INTO papeis (nome, descricao) VALUES
                ('MUNICIPE', 'Cidadao com conta propria para acompanhamento e alertas personalizados.')
            ON CONFLICT (nome) DO NOTHING;
        END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
        v_pesquisador_id UUID;
        v_municipe_id UUID;
    BEGIN
        SELECT id INTO v_pesquisador_id FROM papeis WHERE nome = 'PESQUISADOR';
        SELECT id INTO v_municipe_id FROM papeis WHERE nome = 'MUNICIPE';

        IF v_municipe_id IS NOT NULL AND v_pesquisador_id IS NULL THEN
            UPDATE papeis
            SET nome = 'PESQUISADOR',
                descricao = 'Acesso somente de consulta a series historicas.'
            WHERE id = v_municipe_id;
        ELSIF v_municipe_id IS NOT NULL AND v_pesquisador_id IS NOT NULL THEN
            UPDATE usuarios
            SET papel_id = v_pesquisador_id
            WHERE papel_id = v_municipe_id;

            DELETE FROM papeis WHERE id = v_municipe_id;
        END IF;
    END $$;
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
