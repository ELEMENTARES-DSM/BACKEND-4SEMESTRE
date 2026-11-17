/**
 * US-39 (ELEM-261) / ELEM-264: renomeia os campos de calibração do sensor.
 *
 *   fator -> fator_conversao
 *   ganho -> offset_calibracao
 *
 * Fórmula: valor = bruto x fator_conversao + offset. O nome "ganho" confundia
 * (em eletrônica, ganho é multiplicativo, e aqui ele somava). A coluna é
 * offset_calibracao, e não offset, porque OFFSET é palavra reservada do
 * PostgreSQL ("s.offset" dá erro de sintaxe); o campo da API e da tela
 * continua se chamando offset.
 *
 * Mudança incompatível: esta migration vale para todos os serviços de uma vez.
 * O servico-validacao lê com alias (s.fator_conversao AS fator, ...) até a
 * ELEM-265. O release é único: backend e front no mesmo dia, com
 * npm run migrate antes de subir os contêineres.
 *
 * Só DDL. Idempotente: cada RENAME só roda se a coluna antiga ainda existe
 * (RENAME COLUMN não tem IF EXISTS). Os dados e os valores padrão (1.0 e 0.0)
 * são preservados.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

const renomear = (tabela, de, para) => `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = '${tabela}'
        AND column_name = '${de}'
    ) THEN
      ALTER TABLE ${tabela} RENAME COLUMN ${de} TO ${para};
    END IF;
  END
  $$;
`;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(renomear("sensores", "fator", "fator_conversao"));
  pgm.sql(renomear("sensores", "ganho", "offset_calibracao"));
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(renomear("sensores", "fator_conversao", "fator"));
  pgm.sql(renomear("sensores", "offset_calibracao", "ganho"));
};

module.exports = {
  shorthands,
  up,
  down,
};
