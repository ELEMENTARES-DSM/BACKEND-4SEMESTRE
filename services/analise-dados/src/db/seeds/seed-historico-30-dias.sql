-- Inserir Estações
INSERT INTO estacoes (id, nome, latitude, longitude, created_at, updated_at) VALUES
('ESTACAO_A_HISTORICO', 'Estação A - Histórico Completo', -23.5505, -46.6333, CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP),
('ESTACAO_B_RECENTE', 'Estação B - Recém Instalada', -23.5505, -46.6333, CURRENT_TIMESTAMP - INTERVAL '12 hours', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Inserir Sensores para as Estações
INSERT INTO sensores (id, estacao_id, tipo, grandeza, unidade, status, created_at, updated_at) VALUES
('SENSOR_A_PM25', 'ESTACAO_A_HISTORICO', 'PARTICULADOS', 'PM2.5', 'ug/m3', 'ATIVO', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP),
('SENSOR_A_PM10', 'ESTACAO_A_HISTORICO', 'PARTICULADOS', 'PM10', 'ug/m3', 'ATIVO', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP),
('SENSOR_A_UMIDADE', 'ESTACAO_A_HISTORICO', 'CLIMATICO', 'UMIDADE', '%', 'ATIVO', CURRENT_TIMESTAMP - INTERVAL '31 days', CURRENT_TIMESTAMP),
('SENSOR_B_PM25', 'ESTACAO_B_RECENTE', 'PARTICULADOS', 'PM2.5', 'ug/m3', 'ATIVO', CURRENT_TIMESTAMP - INTERVAL '12 hours', CURRENT_TIMESTAMP),
('SENSOR_B_PM10', 'ESTACAO_B_RECENTE', 'PARTICULADOS', 'PM10', 'ug/m3', 'ATIVO', CURRENT_TIMESTAMP - INTERVAL '12 hours', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- Gerar massa de dados para Estacao A (30 dias)
DO $$
DECLARE
    hora_atual TIMESTAMP := CURRENT_TIMESTAMP - INTERVAL '30 days';
    fim TIMESTAMP := CURRENT_TIMESTAMP;
    i INT := 0;
BEGIN
    WHILE hora_atual <= fim LOOP
        -- Cenário Normal (Válido)
        INSERT INTO medidas (sensor_id, valor, data_hora, valida)
        VALUES ('SENSOR_A_PM25', random() * 50 + 10, hora_atual, true);
        
        INSERT INTO medidas (sensor_id, valor, data_hora, valida)
        VALUES ('SENSOR_A_PM10', random() * 80 + 20, hora_atual, true);
        
        INSERT INTO medidas (sensor_id, valor, data_hora, valida)
        VALUES ('SENSOR_A_UMIDADE', random() * 30 + 40, hora_atual, true);

        -- Cenário de Descarte (Inválido) a cada 24 horas
        IF i % 24 = 0 THEN
            INSERT INTO medidas (sensor_id, valor, data_hora, valida)
            VALUES ('SENSOR_A_PM25', 9999, hora_atual + INTERVAL '30 minutes', false);
        END IF;

        hora_atual := hora_atual + INTERVAL '1 hour';
        i := i + 1;
    END LOOP;
END $$;

-- Gerar massa de dados para Estacao B (últimas 12 horas)
DO $$
DECLARE
    hora_atual TIMESTAMP := CURRENT_TIMESTAMP - INTERVAL '12 hours';
    fim TIMESTAMP := CURRENT_TIMESTAMP;
BEGIN
    WHILE hora_atual <= fim LOOP
        INSERT INTO medidas (sensor_id, valor, data_hora, valida)
        VALUES ('SENSOR_B_PM25', random() * 50 + 10, hora_atual, true);
        
        INSERT INTO medidas (sensor_id, valor, data_hora, valida)
        VALUES ('SENSOR_B_PM10', random() * 80 + 20, hora_atual, true);
        
        hora_atual := hora_atual + INTERVAL '1 hour';
    END LOOP;
END $$;
