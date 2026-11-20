/**
 * US-39 (ELEM-261) / ELEM-264: carga das grandezas iniciais do catálogo.
 *
 * Insere as 8 grandezas: as 5 que o sistema já aceitava e 3 novas. As faixas
 * físicas são as mesmas que o servico-validacao usa hoje (FAIXAS_FISICAS).
 *
 * Só DML (a tabela é criada na migration anterior). A agregação é "soma" para
 * Precipitação (o total no período), "media_circular" para Direção do Vento
 * (a média aritmética de 359° e 1° daria 180°) e "media" para as demais.
 *
 * Idempotente: INSERT ... ON CONFLICT DO NOTHING. Se um Administrador já
 * tiver cadastrado uma dessas grandezas pelo POST, a linha dele é mantida.
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
    INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max, agregacao) VALUES
        ('Temperatura',         '°C',      -50,   60, 'media'),
        ('Umidade Relativa',    '%',         0,  100, 'media'),
        ('PM2.5',               'µg/m³',     0, 1000, 'media'),
        ('PM10',                'µg/m³',     0, 1000, 'media'),
        ('Velocidade do Vento', 'km/h',      0,  400, 'media'),
        ('Direção do Vento',    '°',         0,  360, 'media_circular'),
        ('Precipitação',        'mm',        0,  500, 'soma'),
        ('Pressão Atmosférica', 'hPa',     600, 1100, 'media')
    ON CONFLICT (nome) DO NOTHING;
  `);
};

/**
 * Remove só as 8 grandezas da carga; grandezas criadas depois pelo
 * Administrador ficam. Quando a FK de sensores existir, o banco recusa a
 * remoção de uma grandeza em uso (e a migration da FK é desfeita antes desta).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
const down = (pgm) => {
  pgm.sql(`
    DELETE FROM tipos_sensor
    WHERE nome IN (
        'Temperatura', 'Umidade Relativa', 'PM2.5', 'PM10',
        'Velocidade do Vento', 'Direção do Vento', 'Precipitação',
        'Pressão Atmosférica'
    );
  `);
};

module.exports = {
  shorthands,
  up,
  down,
};
