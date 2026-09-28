-- Seed manual só pra testar GET /estacoes/status

INSERT INTO estacoes (id, codigo, nome, municipio, latitude, longitude, status, nivel_bateria, ultimo_ping)
VALUES
    -- Ativa e ping recente
    ('33333333-3333-4333-8333-333333333333', 'EST-003', 'Estação Parque Vicentina Aranha',
     'São José dos Campos', -23.187600, -45.884300, 'Ativa', 87, NOW() - INTERVAL '10 minutes'),

    -- Ativa mas sem ping há mais de 45 min
    ('44444444-4444-4444-8444-444444444444', 'EST-004', 'Estação Jardim Aquarius',
     'São José dos Campos', -23.221300, -45.908700, 'Ativa', 42, NOW() - INTERVAL '2 hours'),

    -- Ativa e nunca pingou (ultimo_ping NULL)
    ('55555555-5555-4555-8555-555555555555', 'EST-005', 'Estação Eugênio de Melo',
     'São José dos Campos', -23.153900, -45.797600, 'Ativa', NULL, NULL),

    -- Inativa com ping recente
    ('66666666-6666-4666-8666-666666666666', 'EST-006', 'Estação Santana',
     'São José dos Campos', -23.163400, -45.900200, 'Inativa', 100, NOW() - INTERVAL '1 minute'),

    -- Status persistido 'Com Falha' com ping recente
    ('77777777-7777-4777-8777-777777777777', 'EST-007', 'Estação Vila Industrial',
     'São José dos Campos', -23.196100, -45.866000, 'Com Falha', 15, NOW() - INTERVAL '5 minutes')
ON CONFLICT (codigo) DO UPDATE
SET status        = EXCLUDED.status,
    nivel_bateria = EXCLUDED.nivel_bateria,
    ultimo_ping   = EXCLUDED.ultimo_ping;
