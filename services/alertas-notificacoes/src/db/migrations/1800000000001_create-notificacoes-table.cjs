/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

/**
 * US-23: avisos de alarme enviados aos gestores. Só o alertas-notificacoes grava.
 * alarme_id (servico-validacao) e destinatario_id (gestao-usuarios) não têm FK:
 * são tabelas de outros serviços.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS notificacoes (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        alarme_id        UUID         NOT NULL,
        destinatario_id  UUID         NOT NULL,
        canal            VARCHAR(20)  NOT NULL,
        situacao         VARCHAR(10)  NOT NULL DEFAULT 'pendente',
        tentativas       SMALLINT     NOT NULL DEFAULT 0,
        ultimo_erro      TEXT,
        criado_em        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
        enviado_em       TIMESTAMPTZ,

        CONSTRAINT uq_notificacoes_alarme_destinatario_canal
            UNIQUE (alarme_id, destinatario_id, canal),

        CONSTRAINT chk_notificacoes_canal
            CHECK (canal IN ('email')),

        CONSTRAINT chk_notificacoes_situacao
            CHECK (situacao IN ('pendente', 'enviado', 'falhou')),

        CONSTRAINT chk_notificacoes_tentativas
            CHECK (tentativas >= 0),

        CONSTRAINT chk_notificacoes_enviado_em
            CHECK ((situacao = 'enviado') = (enviado_em IS NOT NULL))
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_notificacoes_alarme
    ON notificacoes (alarme_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS notificacoes;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
