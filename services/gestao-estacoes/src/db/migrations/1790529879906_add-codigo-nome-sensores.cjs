const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE sensores
      ADD COLUMN codigo VARCHAR(30),
      ADD COLUMN nome VARCHAR(100);
  `);
};

const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE sensores
      DROP COLUMN codigo,
      DROP COLUMN nome;
  `);
};

module.exports = {
  up,
  down,
};
