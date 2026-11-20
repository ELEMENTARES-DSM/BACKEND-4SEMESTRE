/**
 * US-39 (ELEM-261) / ELEM-264: catálogo de grandezas.
 *
 * Cria a tabela tipos_sensor, mantida pelo Administrador. Cada grandeza tem
 * nome, unidade, faixa física (usada na validação das medidas e nos limites
 * das regras de alerta) e a agregação das séries por hora e por dia (a conta
 * em si é da US-35; aqui só fica a coluna).
 *
 * Só DDL: a carga das grandezas iniciais está na migration seguinte, e o vínculo
 * de sensores com o catálogo (FK) vem depois. Nesta etapa os sensores ainda
 * não usam a tabela.
 *
 * Idempotente: CREATE TABLE IF NOT EXISTS. O node-pg-migrate também não
 * reaplica migrations já registradas em pgmigrations_estacoes.
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
  // gen_random_uuid() vem da extensão pgcrypto, criada na migration de estacoes.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS tipos_sensor (
        id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
        nome       VARCHAR(100)   NOT NULL UNIQUE,
        unidade    VARCHAR(20)    NOT NULL,
        faixa_min  NUMERIC(12,2)  NOT NULL,
        faixa_max  NUMERIC(12,2)  NOT NULL,
        agregacao  VARCHAR(20)    NOT NULL DEFAULT 'media',

        CONSTRAINT chk_faixa_tipo_sensor
          CHECK (faixa_min < faixa_max),
        CONSTRAINT chk_agregacao_tipo_sensor
          CHECK (agregacao IN ('media', 'soma', 'media_circular'))
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS tipos_sensor;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
