/**
 * US-39 (ELEM-261) / ELEM-264: o tipo do sensor passa a vir do catálogo.
 *
 * Remove o CHECK fixo chk_tipo_sensor (lista das 5 grandezas originais) e cria
 * a FK sensores.tipo -> tipos_sensor.nome. Os sensores existentes continuam
 * válidos porque as 5 grandezas antigas já foram inseridas no catálogo
 * (migration ...908).
 *
 * Também alarga sensores.tipo de VARCHAR(50) para VARCHAR(100), o tamanho de
 * tipos_sensor.nome: sem isso, uma grandeza com nome de 51 a 100 caracteres
 * poderia ser criada no catálogo, mas nenhum sensor poderia usá-la.
 *
 * Só DDL. Idempotente: DROP ... IF EXISTS antes de cada ADD. A FK não tem
 * ON DELETE CASCADE: o banco recusa (23503) apagar uma grandeza em uso.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
const shorthands = undefined;

const GRANDEZAS_ORIGINAIS = [
  "Temperatura",
  "Umidade Relativa",
  "PM2.5",
  "PM10",
  "Velocidade do Vento",
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const up = (pgm) => {
  pgm.sql(`ALTER TABLE sensores DROP CONSTRAINT IF EXISTS chk_tipo_sensor;`);

  pgm.sql(`ALTER TABLE sensores ALTER COLUMN tipo TYPE VARCHAR(100);`);

  pgm.sql(`
    ALTER TABLE sensores
      DROP CONSTRAINT IF EXISTS fk_sensores_tipo,
      ADD CONSTRAINT fk_sensores_tipo
        FOREIGN KEY (tipo) REFERENCES tipos_sensor (nome);
  `);
};

/**
 * Reversão. Só é segura enquanto nenhum sensor usa grandeza criada pelo
 * catálogo (fora da lista original): o CHECK antigo não aceitaria esses
 * valores. Nesse caso a migration aborta (a transação do node-pg-migrate faz
 * rollback) em vez de apagar dados ou perder o vínculo com o catálogo.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  const lista = GRANDEZAS_ORIGINAIS.map((nome) => `'${nome}'`).join(", ");

  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM sensores WHERE tipo NOT IN (${lista})) THEN
        RAISE EXCEPTION
          'Rollback bloqueado: existem sensores com grandezas criadas no catálogo (fora da lista original).';
      END IF;
    END
    $$;
  `);

  pgm.sql(`ALTER TABLE sensores DROP CONSTRAINT IF EXISTS fk_sensores_tipo;`);

  pgm.sql(`ALTER TABLE sensores ALTER COLUMN tipo TYPE VARCHAR(50);`);

  pgm.sql(`
    ALTER TABLE sensores
      DROP CONSTRAINT IF EXISTS chk_tipo_sensor,
      ADD CONSTRAINT chk_tipo_sensor CHECK (tipo IN (${lista}));
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
