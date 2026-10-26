/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE staging_telemetria (
      id UUID PRIMARY KEY,
      estacao_uuid UUID NOT NULL,
      unixtime BIGINT,
      payload_bruto TEXT NOT NULL,
      payload JSONB,
      mac_address VARCHAR(20),
      status VARCHAR(20) NOT NULL DEFAULT 'recebida',
      motivo_rejeicao VARCHAR(255),
      processando BOOLEAN NOT NULL DEFAULT FALSE,
      criado_em TIMESTAMPTZ NOT NULL,
      processado_em TIMESTAMPTZ,
      tentativas SMALLINT NOT NULL DEFAULT 0,
      ultimo_erro TEXT,

      CONSTRAINT chk_staging_status
        CHECK (
          status IN ('recebida', 'pendente', 'publicada', 'rejeitada')
        ),

      CONSTRAINT chk_staging_unixtime
        CHECK (
          status = 'rejeitada' OR unixtime IS NOT NULL
        ),

      CONSTRAINT chk_staging_motivo
        CHECK (
          (
            status = 'rejeitada'
            AND motivo_rejeicao IS NOT NULL
            AND length(trim(motivo_rejeicao)) > 0
          )
          OR
          (
            status <> 'rejeitada'
            AND motivo_rejeicao IS NULL
          )
        )
    );

    CREATE UNIQUE INDEX uq_staging_estacao_unixtime
      ON staging_telemetria (estacao_uuid, unixtime)
      WHERE status <> 'rejeitada';

    CREATE INDEX idx_staging_status
      ON staging_telemetria (status);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    DROP TABLE staging_telemetria;
  `);
};

/* global module */
module.exports = {
  shorthands,
  up,
  down,
};