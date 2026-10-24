-- Estações e sensores só do teste contínuo da ingestão (US-21).
-- Município próprio, para não se misturar com os dados do time; fator 1 e
-- ganho 0, para o valor real ser o valor enviado. Pode rodar mais de uma vez.

INSERT INTO estacoes (id, codigo, nome, municipio, latitude, longitude, status)
SELECT
    ('f1000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
    'TF-' || lpad(n::text, 2, '0'),
    'Estação do teste de fluxo ' || lpad(n::text, 2, '0'),
    'Teste Fluxo',
    -23.200000 - n / 1000.0,
    -45.900000,
    'Ativa'
FROM generate_series(1, 10) AS n
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO sensores (estacao_id, codigo, nome, tipo, unidade_medida, fator, ganho, status)
SELECT e.id, s.codigo, s.nome, s.tipo, s.unidade, 1.0, 0.0, 'Ativo'
FROM estacoes e
CROSS JOIN (VALUES
    ('TEMP-01',  'Temperatura do ar',      'Temperatura',         '°C'),
    ('UMID-01',  'Umidade relativa do ar', 'Umidade Relativa',    '%'),
    ('PM25-01',  'Material particulado',   'PM2.5',               'µg/m³'),
    ('PM10-01',  'Material particulado',   'PM10',                'µg/m³'),
    ('VENTO-01', 'Velocidade do vento',    'Velocidade do Vento', 'km/h')
) AS s (codigo, nome, tipo, unidade)
WHERE e.municipio = 'Teste Fluxo'
ON CONFLICT (estacao_id, tipo) DO NOTHING;
