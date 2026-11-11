-- Seed de dados históricos cobrindo 30 dias para análise de dados e painéis
-- Contempla estações, sensores, volumetria histórica, variação normal de grandezas,
-- medidas inválidas (valida = false) para teste de descarte automático
-- e estação recém-instalada (< 24h) para teste de IQAr indisponível por dados insuficientes.

-- 1. Inserir Estações
INSERT INTO estacoes (id, codigo, nome, municipio, latitude, longitude, status, criado_em)
VALUES
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'EST-HIST-01', 'Estação A - Histórico Completo', 'São José dos Campos', -23.180000, -45.880000, 'Ativa', CURRENT_TIMESTAMP - INTERVAL '31 days'),
  ('e0000000-0000-4000-8000-000000000002'::uuid, 'EST-REC-02', 'Estação B - Recém Instalada', 'São José dos Campos', -23.190000, -45.890000, 'Ativa', CURRENT_TIMESTAMP - INTERVAL '12 hours')
ON CONFLICT (id) DO UPDATE
SET codigo = EXCLUDED.codigo,
    nome = EXCLUDED.nome,
    municipio = EXCLUDED.municipio,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    status = EXCLUDED.status;

-- 2. Inserir Sensores para as Estações
INSERT INTO sensores (id, estacao_id, codigo, nome, tipo, unidade_medida, fator, ganho, status, criado_em)
VALUES
  ('b0000000-0000-4000-8000-000000000001'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'PM25-HIST-01', 'Sensor PM2.5 - Histórico', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo', CURRENT_TIMESTAMP - INTERVAL '31 days'),
  ('b0000000-0000-4000-8000-000000000002'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'PM10-HIST-01', 'Sensor PM10 - Histórico', 'PM10', 'µg/m³', 1.0, 0.0, 'Ativo', CURRENT_TIMESTAMP - INTERVAL '31 days'),
  ('b0000000-0000-4000-8000-000000000003'::uuid, 'e0000000-0000-4000-8000-000000000001'::uuid, 'UMID-HIST-01', 'Sensor Umidade - Histórico', 'Umidade Relativa', '%', 1.0, 0.0, 'Ativo', CURRENT_TIMESTAMP - INTERVAL '31 days'),
  ('b0000000-0000-4000-8000-000000000004'::uuid, 'e0000000-0000-4000-8000-000000000002'::uuid, 'PM25-REC-02', 'Sensor PM2.5 - Recente', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo', CURRENT_TIMESTAMP - INTERVAL '12 hours'),
  ('b0000000-0000-4000-8000-000000000005'::uuid, 'e0000000-0000-4000-8000-000000000002'::uuid, 'PM10-REC-02', 'Sensor PM10 - Recente', 'PM10', 'µg/m³', 1.0, 0.0, 'Ativo', CURRENT_TIMESTAMP - INTERVAL '12 hours')
ON CONFLICT (id) DO UPDATE
SET codigo = EXCLUDED.codigo,
    nome = EXCLUDED.nome,
    tipo = EXCLUDED.tipo,
    unidade_medida = EXCLUDED.unidade_medida,
    status = EXCLUDED.status;

-- 3. Massa de dados para Estação A (30 dias de medições horárias com variação normal)
-- PM2.5: faixa de 10 a 50 µg/m³ (medidas válidas)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000001'::uuid,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  ROUND((random() * 40 + 10)::numeric, 2),
  ROUND((random() * 40 + 10)::numeric, 2),
  true,
  gen_random_uuid(),
  dt
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '1 hour'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- PM10: faixa de 20 a 80 µg/m³ (medidas válidas)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000002'::uuid,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  ROUND((random() * 60 + 20)::numeric, 2),
  ROUND((random() * 60 + 20)::numeric, 2),
  true,
  gen_random_uuid(),
  dt
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '1 hour'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- Umidade Relativa: faixa de 40% a 80% (medidas válidas)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000003'::uuid,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  ROUND((random() * 40 + 40)::numeric, 2),
  ROUND((random() * 40 + 40)::numeric, 2),
  true,
  gen_random_uuid(),
  dt
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '1 hour'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 4. Medidas inválidas (valida = false) a cada 24 horas para teste de descarte automático
-- Valores anômalos (9999) gerados no minuto :30
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000001'::uuid,
  EXTRACT(EPOCH FROM (dt + INTERVAL '30 minutes'))::BIGINT,
  9999.000000,
  9999.000000,
  false,
  gen_random_uuid(),
  dt + INTERVAL '30 minutes'
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '24 hours'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 5. Massa de dados para Estação B (últimas 12 horas - dados insuficientes para cálculo de IQAr 24h)
-- PM2.5
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000004'::uuid,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  ROUND((random() * 40 + 10)::numeric, 2),
  ROUND((random() * 40 + 10)::numeric, 2),
  true,
  gen_random_uuid(),
  dt
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '12 hours'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '1 hour'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- PM10
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  'b0000000-0000-4000-8000-000000000005'::uuid,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  ROUND((random() * 60 + 20)::numeric, 2),
  ROUND((random() * 60 + 20)::numeric, 2),
  true,
  gen_random_uuid(),
  dt
FROM generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '12 hours'),
  date_trunc('hour', CURRENT_TIMESTAMP),
  INTERVAL '1 hour'
) AS dt
ON CONFLICT (sensor_id, unixtime) DO NOTHING;
