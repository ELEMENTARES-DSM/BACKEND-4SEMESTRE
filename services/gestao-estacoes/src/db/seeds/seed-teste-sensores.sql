-- Seed manual só pra testar as rotas de sensores.
-- ID fixo (11111111-...)

INSERT INTO estacoes (id, codigo, nome, municipio, status_administrativo)
VALUES (
    '11111111-1111-1111-1111-111111111111',
    'EST-001',
    'Estação Centro',
    'São José dos Campos',
    'Ativa'
)
ON CONFLICT (codigo) DO NOTHING;

-- Estação de outro município, pra testar o 403 de RNF-06 (posse por município)
INSERT INTO estacoes (id, codigo, nome, municipio, status_administrativo)
VALUES (
    '22222222-2222-2222-2222-222222222222',
    'EST-002',
    'Estação Centro SP',
    'São Paulo',
    'Ativa'
)
ON CONFLICT (codigo) DO NOTHING;