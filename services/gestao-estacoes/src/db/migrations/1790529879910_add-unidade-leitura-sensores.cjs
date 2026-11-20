/**
 * US-39 (ELEM-261) / ELEM-264: unidade em que a placa envia a leitura.
 *
 * Adiciona sensores.unidade_leitura, opcional. Exemplo: um sensor que envia
 * em Kelvin (K) tem unidade_leitura = 'K' e unidade_medida = '°C' (a unidade
 * da grandeza). O campo só informa: quem converte é o par fator_conversao e
 * offset (valor = bruto x fator_conversao + offset), então um sensor em
 * Kelvin precisa de offset -273,15.
 *
 * Só DDL. Idempotente: ADD COLUMN IF NOT EXISTS. Sensores existentes ficam
 * com NULL, que significa "a placa já envia na unidade da grandeza".
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`ALTER TABLE sensores ADD COLUMN IF NOT EXISTS unidade_leitura VARCHAR(20);`);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`ALTER TABLE sensores DROP COLUMN IF EXISTS unidade_leitura;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
