\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  station uuid;
  other_station uuid;
  sensor uuid;
  code text := 'IT-' || substr(gen_random_uuid()::text, 1, 20);
BEGIN
  INSERT INTO estacoes (codigo, nome, municipio, latitude, longitude)
  VALUES (code, 'Estação de teste', 'São José dos Campos', -23.18, -45.88)
  RETURNING id INTO station;
  IF NOT EXISTS (SELECT 1 FROM estacoes WHERE id = station AND codigo = code AND status = 'Ativa' AND criado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Falha na persistência/defaults da estação';
  END IF;
  RAISE NOTICE 'PASS: criação, consulta e defaults da estação';

  BEGIN
    INSERT INTO estacoes (codigo, nome, municipio, latitude, longitude)
    VALUES (code, 'Duplicada', 'Teste', 0, 0);
    RAISE EXCEPTION 'Código duplicado foi aceito';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: código da estação é único';
  END;
  BEGIN
    UPDATE estacoes SET latitude = 91 WHERE id = station;
    RAISE EXCEPTION 'Latitude inválida foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: latitude inválida rejeitada';
  END;
  BEGIN
    UPDATE estacoes SET longitude = -181 WHERE id = station;
    RAISE EXCEPTION 'Longitude inválida foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: longitude inválida rejeitada';
  END;

  INSERT INTO sensores (estacao_id, codigo, nome, grandeza, unidade)
  VALUES (station, 'S-01', 'Sensor de teste', 'TEMPERATURA', 'C') RETURNING id INTO sensor;
  IF NOT EXISTS (SELECT 1 FROM sensores WHERE id = sensor AND estacao_id = station AND status = 'Ativo' AND criado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Falha na persistência/vínculo/defaults do sensor';
  END IF;
  RAISE NOTICE 'PASS: sensor persistido e vinculado à estação';
  BEGIN
    INSERT INTO sensores (estacao_id, codigo, nome, grandeza, unidade)
    VALUES (station, 'S-01', 'Duplicado', 'TEMPERATURA', 'C');
    RAISE EXCEPTION 'Sensor duplicado na mesma estação foi aceito';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS: código do sensor é único por estação';
  END;

  INSERT INTO estacoes (codigo, nome, municipio, latitude, longitude)
  VALUES (code || '-2', 'Outra estação', 'Teste', 0, 0) RETURNING id INTO other_station;
  INSERT INTO sensores (estacao_id, codigo, nome, grandeza, unidade)
  VALUES (other_station, 'S-01', 'Outro sensor', 'TEMPERATURA', 'C');
  RAISE NOTICE 'PASS: mesmo código de sensor permitido em outra estação';
  BEGIN
    UPDATE sensores SET estacao_id = gen_random_uuid() WHERE id = sensor;
    RAISE EXCEPTION 'Estação inexistente foi aceita';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: sensor exige estação existente';
  END;
  BEGIN
    UPDATE sensores SET grandeza = 'INVALIDA' WHERE id = sensor;
    RAISE EXCEPTION 'Grandeza inválida foi aceita';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: grandeza inválida rejeitada';
  END;
  BEGIN
    DELETE FROM estacoes WHERE id = station;
    RAISE EXCEPTION 'Exclusão de estação com sensor foi aceita';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: exclusão de estação com sensor bloqueada';
  END;
END $$;
ROLLBACK;
