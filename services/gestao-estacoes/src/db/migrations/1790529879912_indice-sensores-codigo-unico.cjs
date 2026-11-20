/**
 * US-39 (ELEM-261) / ELEM-264: o código do sensor é único por estação.
 *
 * A placa identifica o sensor pelo código que envia no payload MQTT, e o
 * servico-validacao procura o sensor por (estacao_id, codigo). Com dois
 * sensores de mesmo código na estação, a medida iria para um deles ao acaso.
 *
 * Índice único parcial: só vale para código preenchido (WHERE codigo IS NOT
 * NULL), porque sensores antigos podem não ter código (a coluna foi criada
 * depois) e vários NULL na mesma estação continuam permitidos. O cadastro novo
 * exige o código; o PUT deixa definir o código de um sensor antigo uma única vez.
 *
 * Antes de criar o índice, confere os dados existentes: se houver código
 * repetido na mesma estação, a migration aborta (a transação faz rollback)
 * com a lista dos repetidos, em vez de falhar com uma mensagem genérica. Quem
 * roda a migration corrige os dados e roda de novo. Sensores sem código só
 * geram um aviso (NOTICE).
 *
 * Só o índice neste arquivo (DDL de índice em migration separada).
 * Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS.
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
  pgm.sql(`
    DO $$
    DECLARE
      repetidos TEXT;
      sem_codigo INT;
    BEGIN
      SELECT string_agg(
               format('codigo %s na estacao %s (%s sensores)', codigo, estacao_id, total),
               '; ')
        INTO repetidos
        FROM (
          SELECT estacao_id, codigo, count(*) AS total
            FROM sensores
           WHERE codigo IS NOT NULL
           GROUP BY estacao_id, codigo
          HAVING count(*) > 1
           LIMIT 20
        ) d;

      IF repetidos IS NOT NULL THEN
        RAISE EXCEPTION
          'Indice unico de codigo bloqueado: ha sensores com o mesmo codigo na mesma estacao. Corrija e rode de novo. Repetidos (ate 20): %',
          repetidos;
      END IF;

      SELECT count(*) INTO sem_codigo FROM sensores WHERE codigo IS NULL;
      IF sem_codigo > 0 THEN
        RAISE NOTICE '% sensor(es) sem codigo: defina o codigo pelo PUT /sensores/:id para que a placa os alcance.', sem_codigo;
      END IF;
    END
    $$;
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sensores_estacao_codigo
      ON sensores (estacao_id, codigo)
      WHERE codigo IS NOT NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS uq_sensores_estacao_codigo;`);
};

module.exports = {
  shorthands,
  up,
  down,
};
