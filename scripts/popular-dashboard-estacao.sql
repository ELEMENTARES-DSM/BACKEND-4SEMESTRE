-- =============================================================================
-- Script de população do banco de dados para validação do Dashboard da Estação
-- US-35 / TASK 35.13 (ELEM-205)
--
-- IMPORTANTE (Windows PowerShell):
-- Para preservar os acentos em UTF-8, copie o arquivo para o contêiner e rode via psql -f:
--   docker cp "C:\Users\joao_\OneDrive\Área de Trabalho\3-sprint\ver-pr\scripts\popular-dashboard-estacao.sql" backend-4semestre-postgres-1:/tmp/popular.sql
--   docker exec backend-4semestre-postgres-1 psql -U postgres -d pulso -f /tmp/popular.sql
--
-- Usuários disponíveis para login na interface (senha de todos: Admin@123):
--   - Administrador: admin@exemplo.com
--   - Gestor SJC:    gestor.sjc@exemplo.com (São José dos Campos)
--   - Gestor SP:     gestor.sp@exemplo.com  (São Paulo)
--   - Pesquisador:   pesquisador@exemplo.com
--
-- Estações populadas:
--   - EST-001 (Estação Centro - SJC): 30 dias completos + últimas 24h a cada 5 min
--             + medidas inválidas (valida = false) para testar Cenário 1 e Cenário 3.
--             IQAr esperado: faixa "Boa" (~14 µg/m³).
--   - EST-002 (Estação Jardim das Flores - SJC): instalada há 10 horas (< 24h)
--             para testar Cenário 2 ("Sem dados suficientes" no cartão de IQAr).
--   - EST-003 (Estação Parque Industrial - SJC): 30 dias completos com PM2.5 ~35 µg/m³
--             para visualizar a faixa "Moderada" (#FFFF00) no cartão de IQAr.
--   - EST-SP-01 (Estação Paulista - São Paulo): estação de outro município para
--             testar Cenário 4 (404 para o gestor de SJC; visível para o Admin).
-- =============================================================================

SET client_encoding = 'UTF8';

BEGIN;

-- 0. Limpar eventuais registros duplicados com encoding corrompido (mojibake)
DELETE FROM tipos_sensor WHERE nome LIKE '%Ã%' OR unidade LIKE '%Â%';
UPDATE sensores SET unidade_medida = 'µg/m³' WHERE tipo IN ('PM2.5', 'PM10');
UPDATE sensores SET unidade_medida = '°C' WHERE tipo = 'Temperatura';
UPDATE sensores SET unidade_medida = '%' WHERE tipo = 'Umidade Relativa';
UPDATE sensores SET unidade_medida = '°' WHERE tipo = 'Direção do Vento';

-- 1. Garantir papéis (ADMINISTRADOR, GESTOR_PUBLICO, PESQUISADOR, MUNICIPE)
INSERT INTO papeis (id, nome, descricao)
VALUES
  ('9c3cc66d-5013-40f4-82f4-4ed04128422f'::uuid, 'ADMINISTRADOR', 'Gestao irrestrita e global da plataforma.'),
  ('dd7b4fbd-738a-438c-921a-dcb7feb750c1'::uuid, 'GESTOR_PUBLICO', 'Operacao e monitoramento restritos ao proprio municipio.'),
  ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'::uuid, 'PESQUISADOR', 'Consulta e analise de dados ambientais.'),
  ('bd85d5a4-f998-401c-8ded-7a57500ddc2f'::uuid, 'MUNICIPE', 'Cidadao com conta propria para acompanhamento e alertas personalizados.')
ON CONFLICT (nome) DO NOTHING;

-- 2. Garantir usuários de teste (senha de todos: Admin@123)
DO $$
DECLARE
  v_hash text := '$2b$10$HaICrMlv15qkd7qIx1cPH.voeGqeHq7kH0ueYs8sx1Vo/jNTJWFX.';
  v_admin_papel uuid;
  v_gestor_papel uuid;
  v_pesq_papel uuid;
BEGIN
  SELECT id INTO v_admin_papel FROM papeis WHERE nome = 'ADMINISTRADOR' LIMIT 1;
  SELECT id INTO v_gestor_papel FROM papeis WHERE nome = 'GESTOR_PUBLICO' LIMIT 1;
  SELECT id INTO v_pesq_papel FROM papeis WHERE nome = 'PESQUISADOR' LIMIT 1;

  INSERT INTO usuarios (id, nome, email, senha_hash, papel_id, municipio, esta_ativo)
  VALUES
    ('2c0b5a3d-c8f5-40ba-9dcc-7a566762b74e'::uuid, 'Admin Teste', 'admin@exemplo.com', v_hash, v_admin_papel, NULL, true),
    ('3d1c6b4e-d9a6-41cb-8edd-8b677873c85f'::uuid, 'Gestora SJC', 'gestor.sjc@exemplo.com', v_hash, v_gestor_papel, 'São José dos Campos', true),
    ('4e2d7c5f-eab7-42dc-9fee-9c788984d960'::uuid, 'Gestor SP', 'gestor.sp@exemplo.com', v_hash, v_gestor_papel, 'São Paulo', true),
    ('5f3e8d60-fbc8-43ed-8aff-0d899095ea71'::uuid, 'Pesquisadora INPE', 'pesquisador@exemplo.com', v_hash, v_pesq_papel, 'São José dos Campos', true)
  ON CONFLICT (email) DO UPDATE
  SET nome = EXCLUDED.nome,
      senha_hash = EXCLUDED.senha_hash,
      papel_id = EXCLUDED.papel_id,
      municipio = EXCLUDED.municipio,
      esta_ativo = true;
END $$;

-- 3. Garantir catálogo de grandezas (tipos_sensor)
INSERT INTO tipos_sensor (nome, unidade, faixa_min, faixa_max, agregacao)
VALUES
  ('PM2.5', 'µg/m³', 0.00, 1000.00, 'media'),
  ('PM10', 'µg/m³', 0.00, 1000.00, 'media'),
  ('NO2', 'µg/m³', 0.00, 1000.00, 'media'),
  ('O3', 'µg/m³', 0.00, 1000.00, 'media'),
  ('CO', 'ppm', 0.00, 100.00, 'media'),
  ('SO2', 'µg/m³', 0.00, 1000.00, 'media'),
  ('Temperatura', '°C', -50.00, 60.00, 'media'),
  ('Umidade Relativa', '%', 0.00, 100.00, 'media'),
  ('Velocidade do Vento', 'km/h', 0.00, 400.00, 'media'),
  ('Direção do Vento', '°', 0.00, 360.00, 'media_circular'),
  ('Precipitação', 'mm', 0.00, 500.00, 'soma'),
  ('Pressão Atmosférica', 'hPa', 600.00, 1100.00, 'media')
ON CONFLICT (nome) DO UPDATE
SET unidade = EXCLUDED.unidade;

-- 4. Inserir / atualizar estações para o Dashboard (US-35)
INSERT INTO estacoes (id, codigo, nome, municipio, latitude, longitude, status, nivel_bateria, ultimo_ping, criado_em)
VALUES
  (
    '11111111-1111-4111-8111-111111111111'::uuid,
    'EST-001',
    'Estação Centro',
    'São José dos Campos',
    -23.179100,
    -45.887200,
    'Ativa',
    94,
    CURRENT_TIMESTAMP - INTERVAL '2 minutes',
    CURRENT_TIMESTAMP - INTERVAL '35 days'
  ),
  (
    '22222222-2222-4222-8222-222222222222'::uuid,
    'EST-002',
    'Estação Jardim das Flores (Recém-instalada)',
    'São José dos Campos',
    -23.223700,
    -45.891400,
    'Ativa',
    98,
    CURRENT_TIMESTAMP - INTERVAL '3 minutes',
    CURRENT_TIMESTAMP - INTERVAL '10 hours'
  ),
  (
    '33333333-3333-4333-8333-333333333333'::uuid,
    'EST-003',
    'Estação Parque Industrial',
    'São José dos Campos',
    -23.245000,
    -45.910000,
    'Ativa',
    87,
    CURRENT_TIMESTAMP - INTERVAL '4 minutes',
    CURRENT_TIMESTAMP - INTERVAL '35 days'
  ),
  (
    '44444444-4444-4444-8444-444444444444'::uuid,
    'EST-SP-01',
    'Estação Avenida Paulista',
    'São Paulo',
    -23.561400,
    -46.655900,
    'Ativa',
    91,
    CURRENT_TIMESTAMP - INTERVAL '1 minute',
    CURRENT_TIMESTAMP - INTERVAL '35 days'
  )
ON CONFLICT (codigo) DO UPDATE
SET nome = EXCLUDED.nome,
    municipio = EXCLUDED.municipio,
    status = EXCLUDED.status,
    nivel_bateria = EXCLUDED.nivel_bateria,
    ultimo_ping = EXCLUDED.ultimo_ping;

-- 5. Inserir sensores das estações
DO $$
DECLARE
  v_est1 uuid;
  v_est2 uuid;
  v_est3 uuid;
  v_est_sp uuid;
BEGIN
  SELECT id INTO v_est1 FROM estacoes WHERE codigo = 'EST-001';
  SELECT id INTO v_est2 FROM estacoes WHERE codigo = 'EST-002';
  SELECT id INTO v_est3 FROM estacoes WHERE codigo = 'EST-003';
  SELECT id INTO v_est_sp FROM estacoes WHERE codigo = 'EST-SP-01';

  -- Sensores da EST-001 (6 poluentes do Figma: PM2.5, PM10, NO2, O3, CO, SO2 + Temperatura e Umidade Relativa)
  INSERT INTO sensores (id, estacao_id, codigo, nome, tipo, unidade_medida, fator_conversao, offset_calibracao, status)
  VALUES
    ('a1111111-1111-4111-8111-000000000001'::uuid, v_est1, 'PM25-001', 'Material Particulado PM2.5', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000002'::uuid, v_est1, 'PM10-001', 'Material Particulado PM10', 'PM10', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000005'::uuid, v_est1, 'NO2-001', 'Dióxido de Nitrogênio', 'NO2', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000006'::uuid, v_est1, 'O3-001', 'Ozônio', 'O3', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000007'::uuid, v_est1, 'CO-001', 'Monóxido de Carbono', 'CO', 'ppm', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000008'::uuid, v_est1, 'SO2-001', 'Dióxido de Enxofre', 'SO2', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000003'::uuid, v_est1, 'TEMP-001', 'Temperatura do Ar', 'Temperatura', '°C', 1.0, 0.0, 'Ativo'),
    ('a1111111-1111-4111-8111-000000000004'::uuid, v_est1, 'UMID-001', 'Umidade Relativa do Ar', 'Umidade Relativa', '%', 1.0, 0.0, 'Ativo'),
    -- Sensores da EST-002 (Recém-instalada: 10h de histórico)
    ('a2222222-2222-4222-8222-000000000001'::uuid, v_est2, 'PM25-002', 'Material Particulado PM2.5', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a2222222-2222-4222-8222-000000000002'::uuid, v_est2, 'TEMP-002', 'Temperatura do Ar', 'Temperatura', '°C', 1.0, 0.0, 'Ativo'),
    -- Sensores da EST-003 (IQAr Moderada)
    ('a3333333-3333-4333-8333-000000000001'::uuid, v_est3, 'PM25-003', 'Material Particulado PM2.5', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo'),
    ('a3333333-3333-4333-8333-000000000002'::uuid, v_est3, 'PM10-003', 'Material Particulado PM10', 'PM10', 'µg/m³', 1.0, 0.0, 'Ativo'),
    -- Sensor da EST-SP-01 (Outro município)
    ('a4444444-4444-4444-8444-000000000001'::uuid, v_est_sp, 'PM25-SP1', 'Material Particulado PM2.5', 'PM2.5', 'µg/m³', 1.0, 0.0, 'Ativo')
  ON CONFLICT (estacao_id, tipo) DO UPDATE
  SET unidade_medida = EXCLUDED.unidade_medida,
      status = 'Ativo';
END $$;

-- 6. Limpar medições antigas desses sensores para garantir dados frescos nos últimos 30 dias
DELETE FROM medidas
WHERE sensor_id IN (
  SELECT s.id
  FROM sensores s
  JOIN estacoes e ON e.id = s.estacao_id
  WHERE e.codigo IN ('EST-001', 'EST-002', 'EST-003', 'EST-SP-01')
);

-- 7. Popular EST-001:
-- 7a. Série histórica de 30 dias até 24h atrás (1 leitura por hora)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((13.5 + 1.5 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((31.2 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'NO2' THEN ROUND((24.8 + 3.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'O3' THEN ROUND((42.6 + 5.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'CO' THEN ROUND((0.72 + 0.1 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'SO2' THEN ROUND((8.1 + 1.2 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'Temperatura' THEN ROUND((23.0 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'Umidade Relativa' THEN ROUND((65.0 + 12.0 * COS(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
  END,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((13.5 + 1.5 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((31.2 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'NO2' THEN ROUND((24.8 + 3.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'O3' THEN ROUND((42.6 + 5.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'CO' THEN ROUND((0.72 + 0.1 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'SO2' THEN ROUND((8.1 + 1.2 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'Temperatura' THEN ROUND((23.0 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
    WHEN 'Umidade Relativa' THEN ROUND((65.0 + 12.0 * COS(EXTRACT(EPOCH FROM dt) / 43200.0))::numeric, 2)
  END,
  true,
  gen_random_uuid(),
  dt AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
CROSS JOIN generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '30 days'),
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '25 hours'),
  INTERVAL '1 hour'
) AS dt
WHERE e.codigo = 'EST-001'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 7b. Últimas 24 horas da EST-001 com pontos a cada 5 minutos (para o filtro de 24 h)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((13.5 + 1.4 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((31.2 + 3.5 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'NO2' THEN ROUND((24.8 + 2.2 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'O3' THEN ROUND((42.6 + 4.1 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'CO' THEN ROUND((0.72 + 0.08 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'SO2' THEN ROUND((8.1 + 0.9 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'Temperatura' THEN ROUND((24.2 + 2.5 * SIN(EXTRACT(EPOCH FROM dt) / 10800.0))::numeric, 2)
    WHEN 'Umidade Relativa' THEN ROUND((62.0 + 8.0 * COS(EXTRACT(EPOCH FROM dt) / 10800.0))::numeric, 2)
  END,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((13.5 + 1.4 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((31.2 + 3.5 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'NO2' THEN ROUND((24.8 + 2.2 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'O3' THEN ROUND((42.6 + 4.1 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'CO' THEN ROUND((0.72 + 0.08 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'SO2' THEN ROUND((8.1 + 0.9 * SIN(EXTRACT(EPOCH FROM dt) / 7200.0))::numeric, 2)
    WHEN 'Temperatura' THEN ROUND((24.2 + 2.5 * SIN(EXTRACT(EPOCH FROM dt) / 10800.0))::numeric, 2)
    WHEN 'Umidade Relativa' THEN ROUND((62.0 + 8.0 * COS(EXTRACT(EPOCH FROM dt) / 10800.0))::numeric, 2)
  END,
  true,
  gen_random_uuid(),
  dt AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
CROSS JOIN generate_series(
  date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '24 hours'),
  date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '2 minutes'),
  INTERVAL '5 minutes'
) AS dt
WHERE e.codigo = 'EST-001'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 7c. Cenário 3: Medida fisicamente impossível de Umidade (120,0%) e de PM2.5 (9999) marcadas como valida = false
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM (date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '15 minutes') + INTERVAL '17 seconds'))::BIGINT,
  120.00,
  120.00,
  false,
  gen_random_uuid(),
  (CURRENT_TIMESTAMP - INTERVAL '15 minutes') AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
WHERE e.codigo = 'EST-001' AND s.tipo = 'Umidade Relativa'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM (date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '10 minutes') + INTERVAL '17 seconds'))::BIGINT,
  9999.00,
  9999.00,
  false,
  gen_random_uuid(),
  (CURRENT_TIMESTAMP - INTERVAL '10 minutes') AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
WHERE e.codigo = 'EST-001' AND s.tipo = 'PM2.5'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 8. Popular EST-002 (Cenário 2: instalada há 10 horas -> IQAr "Sem dados suficientes")
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  CASE s.tipo
    WHEN 'PM2.5' THEN 16.50
    WHEN 'Temperatura' THEN 25.10
  END,
  CASE s.tipo
    WHEN 'PM2.5' THEN 16.50
    WHEN 'Temperatura' THEN 25.10
  END,
  true,
  gen_random_uuid(),
  dt AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
CROSS JOIN generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '10 hours'),
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
  INTERVAL '30 minutes'
) AS dt
WHERE e.codigo = 'EST-002'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 9. Popular EST-003 (IQAr na faixa "Moderada": média 24h de PM2.5 ~35 µg/m³)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((35.0 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 14400.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((62.0 + 8.0 * SIN(EXTRACT(EPOCH FROM dt) / 14400.0))::numeric, 2)
  END,
  CASE s.tipo
    WHEN 'PM2.5' THEN ROUND((35.0 + 4.0 * SIN(EXTRACT(EPOCH FROM dt) / 14400.0))::numeric, 2)
    WHEN 'PM10' THEN ROUND((62.0 + 8.0 * SIN(EXTRACT(EPOCH FROM dt) / 14400.0))::numeric, 2)
  END,
  true,
  gen_random_uuid(),
  dt AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
CROSS JOIN generate_series(
  date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '7 days'),
  date_trunc('minute', CURRENT_TIMESTAMP - INTERVAL '2 minutes'),
  INTERVAL '15 minutes'
) AS dt
WHERE e.codigo = 'EST-003'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- 10. Popular EST-SP-01 (São Paulo - para teste de isolamento municipal Cenário 4)
INSERT INTO medidas (sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em)
SELECT
  s.id,
  EXTRACT(EPOCH FROM dt)::BIGINT,
  42.00,
  42.00,
  true,
  gen_random_uuid(),
  dt AT TIME ZONE 'UTC'
FROM sensores s
JOIN estacoes e ON e.id = s.estacao_id
CROSS JOIN generate_series(
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '48 hours'),
  date_trunc('hour', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
  INTERVAL '1 hour'
) AS dt
WHERE e.codigo = 'EST-SP-01'
ON CONFLICT (sensor_id, unixtime) DO NOTHING;

-- Também executa a carga das estações do seed da ELEM-197 (EST-HIST-01 e EST-REC-02)
INSERT INTO estacoes (id, codigo, nome, municipio, latitude, longitude, status, ultimo_ping, criado_em)
VALUES
  ('e0000000-0000-4000-8000-000000000001'::uuid, 'EST-HIST-01', 'Estação A - Histórico Completo', 'São José dos Campos', -23.180000, -45.880000, 'Ativa', CURRENT_TIMESTAMP - INTERVAL '2 minutes', CURRENT_TIMESTAMP - INTERVAL '31 days'),
  ('e0000000-0000-4000-8000-000000000002'::uuid, 'EST-REC-02', 'Estação B - Recém Instalada', 'São José dos Campos', -23.190000, -45.890000, 'Ativa', CURRENT_TIMESTAMP - INTERVAL '4 minutes', CURRENT_TIMESTAMP - INTERVAL '12 hours')
ON CONFLICT (codigo) DO UPDATE
SET nome = EXCLUDED.nome,
    municipio = EXCLUDED.municipio,
    ultimo_ping = EXCLUDED.ultimo_ping;

COMMIT;
