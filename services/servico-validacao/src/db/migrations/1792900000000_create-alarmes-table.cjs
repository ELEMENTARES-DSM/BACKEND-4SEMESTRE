/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * US-22: alarmes disparados pelas regras de alerta. Só o servico-validacao grava.
 * regra_id, sensor_id e estacao_id não têm FK: são tabelas de outros serviços.
 * limite tem o mesmo tipo de regras_alerta.valor_limite e valor o de medidas.valor.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS alarmes (
      id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
      regra_id        UUID          NOT NULL,
      medida_id       UUID          NOT NULL REFERENCES medidas(id) ON DELETE RESTRICT,
      sensor_id       UUID          NOT NULL,
      estacao_id      UUID          NOT NULL,
      municipio       VARCHAR(100)  NOT NULL,
      valor           NUMERIC(12,6) NOT NULL,
      operador        VARCHAR(2)    NOT NULL,
      limite          NUMERIC(10,2) NOT NULL,
      severidade      VARCHAR(10)   NOT NULL,
      situacao        VARCHAR(12)   NOT NULL DEFAULT 'aberto',
      lido_em         TIMESTAMPTZ   NOT NULL,
      criado_em       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      normalizado_em  TIMESTAMPTZ,
      publicado_em    TIMESTAMPTZ,

      CONSTRAINT uq_alarmes_regra_medida UNIQUE (regra_id, medida_id),
      CONSTRAINT chk_alarmes_operador
        CHECK (operador IN ('>', '>=', '<', '<=', '=')),
      CONSTRAINT chk_alarmes_severidade
        CHECK (severidade IN ('ATENCAO', 'ALERTA', 'CRITICO')),
      CONSTRAINT chk_alarmes_situacao
        CHECK (situacao IN ('aberto', 'normalizado')),
      CONSTRAINT chk_alarmes_normalizado_em
        CHECK ((situacao = 'aberto') = (normalizado_em IS NULL))
    );
  `);

  // Um alarme aberto por regra: a segunda violação seguida não abre outro.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_alarmes_regra_aberto
      ON alarmes (regra_id) WHERE situacao = 'aberto';
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_alarmes_municipio_lido_em
      ON alarmes (municipio, lido_em DESC);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_alarmes_sensor_aberto
      ON alarmes (sensor_id) WHERE situacao = 'aberto';
  `);

  // Alarmes ainda não confirmados pelo RabbitMQ, republicados ao reconectar.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_alarmes_nao_publicados
      ON alarmes (criado_em) WHERE publicado_em IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS alarmes;`);
};

/* global module */
module.exports = {
  shorthands,
  up,
  down,
};
