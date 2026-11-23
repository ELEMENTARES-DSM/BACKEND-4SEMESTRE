/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * MAC da estação física (12 hex minúsculos, sem separador), usado no tópico
 * MQTT pulso/estacoes/<mac>/telemetria. Estações que já existiam recebem um MAC
 * gerado a partir do UUID (prefixo 02 = endereço localmente administrado, para
 * não colidir com MAC de fábrica). Quando a estação real for instalada, o admin
 * troca pelo MAC verdadeiro com PUT /estacoes/:id.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE estacoes ADD COLUMN IF NOT EXISTS mac_address CHAR(12);

    UPDATE estacoes
    SET mac_address = '02' || substr(md5(id::text), 1, 10)
    WHERE mac_address IS NULL;

    ALTER TABLE estacoes
      ADD CONSTRAINT chk_mac_address_formato
      CHECK (mac_address IS NULL OR mac_address ~ '^[0-9a-f]{12}$');

    CREATE UNIQUE INDEX IF NOT EXISTS uq_estacoes_mac_address
      ON estacoes (mac_address)
      WHERE mac_address IS NOT NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS uq_estacoes_mac_address;
    ALTER TABLE estacoes DROP CONSTRAINT IF EXISTS chk_mac_address_formato;
    ALTER TABLE estacoes DROP COLUMN IF EXISTS mac_address;
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
