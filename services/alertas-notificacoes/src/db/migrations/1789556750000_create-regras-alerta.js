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
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  pgm.createTable("regras_alerta", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },

    sensor_id: {
      type: "uuid",
      notNull: true,
      references: "sensores",
      onDelete: "RESTRICT",
    },

    nome: {
      type: "varchar(100)",
      notNull: true,
    },

    operador: {
      type: "varchar(5)",
      notNull: true,
    },

    limiar: {
      type: "numeric(10,2)",
      notNull: true,
    },

    severidade: {
      type: "varchar(20)",
      notNull: true,
    },

    status: {
      type: "varchar(20)",
      notNull: true,
      default: "Ativa",
    },

    criado_em: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.addConstraint(
    "regras_alerta",
    "regras_alerta_operador_check",
    {
      check: "operador IN ('>', '>=', '<', '<=', '=')",
    }
  );

  pgm.addConstraint(
    "regras_alerta",
    "regras_alerta_severidade_check",
    {
      check: "severidade IN ('ATENCAO', 'ALERTA', 'CRITICO')",
    }
  );

  pgm.createIndex("regras_alerta", "sensor_id");
  pgm.createIndex("regras_alerta", "status");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.dropIndex("regras_alerta", "regras_alerta_sensor_id_idx");
  pgm.dropIndex("regras_alerta", "regras_alerta_status_idx");
  pgm.dropConstraint("regras_alerta", "regras_alerta_operador_check");
  pgm.dropConstraint("regras_alerta", "regras_alerta_severidade_check");
  pgm.dropTable("regras_alerta");
};

module.exports = {
  shorthands,
  up,
  down,
};
