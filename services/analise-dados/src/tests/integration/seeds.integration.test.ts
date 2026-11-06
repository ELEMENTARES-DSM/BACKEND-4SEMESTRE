import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env.test') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'elem_analise_dados_test',
});

describe('Seeds Integration: seed-historico-30-dias.sql', () => {
  beforeAll(async () => {
    // 1. Limpar as tabelas afetadas
    await pool.query('DELETE FROM medidas WHERE sensor_id IN (SELECT id FROM sensores WHERE estacao_id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\'))');
    await pool.query('DELETE FROM sensores WHERE estacao_id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\')');
    await pool.query('DELETE FROM estacoes WHERE id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\')');

    // 2. Executar o seed
    const seedPath = path.resolve(__dirname, '../../db/seeds/seed-historico-30-dias.sql');
    const seedSql = fs.readFileSync(seedPath, 'utf-8');
    await pool.query(seedSql);
  });

  afterAll(async () => {
    // Limpeza após os testes
    await pool.query('DELETE FROM medidas WHERE sensor_id IN (SELECT id FROM sensores WHERE estacao_id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\'))');
    await pool.query('DELETE FROM sensores WHERE estacao_id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\')');
    await pool.query('DELETE FROM estacoes WHERE id IN (\'ESTACAO_A_HISTORICO\', \'ESTACAO_B_RECENTE\')');
    await pool.end();
  });

  it('deve popular o banco com a volumetria correta', async () => {
    // Estação A: 30 dias * 24 horas = ~720 horas. 3 sensores = ~2160 medidas válidas. + ~30 inválidas
    const resultEstacaoA = await pool.query(\`
      SELECT COUNT(*) as total 
      FROM medidas m 
      JOIN sensores s ON m.sensor_id = s.id 
      WHERE s.estacao_id = 'ESTACAO_A_HISTORICO'
    \`);
    const totalA = parseInt(resultEstacaoA.rows[0].total);
    expect(totalA).toBeGreaterThan(2000);

    // Estação B: 12 horas * 2 sensores = ~24 medidas válidas
    const resultEstacaoB = await pool.query(\`
      SELECT COUNT(*) as total 
      FROM medidas m 
      JOIN sensores s ON m.sensor_id = s.id 
      WHERE s.estacao_id = 'ESTACAO_B_RECENTE'
    \`);
    const totalB = parseInt(resultEstacaoB.rows[0].total);
    expect(totalB).toBeGreaterThanOrEqual(24);
  });

  it('deve desconsiderar registros com valida = false no calculo de medias', async () => {
    // Consulta para calcular a média (considerando apenas válidas) vs (considerando todas)
    const result = await pool.query(\`
      SELECT 
        AVG(CASE WHEN valida = true THEN valor ELSE NULL END) as media_valida,
        AVG(valor) as media_geral,
        COUNT(CASE WHEN valida = false THEN 1 ELSE NULL END) as total_invalidas
      FROM medidas m
      JOIN sensores s ON m.sensor_id = s.id
      WHERE s.estacao_id = 'ESTACAO_A_HISTORICO' AND s.grandeza = 'PM2.5'
    \`);

    const mediaValida = parseFloat(result.rows[0].media_valida);
    const mediaGeral = parseFloat(result.rows[0].media_geral);
    const totalInvalidas = parseInt(result.rows[0].total_invalidas);

    // A média geral (com os valores 9999) deve ser significativamente maior que a média válida
    expect(totalInvalidas).toBeGreaterThan(0);
    expect(mediaValida).toBeLessThan(100); // Variação normal é 10 a 60
    expect(mediaGeral).toBeGreaterThan(mediaValida);
  });

  it('deve identificar estacao com dados insuficientes (< 24h)', async () => {
    const result = await pool.query(\`
      SELECT 
        MIN(data_hora) as primeira_medida,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(data_hora))) / 3600 as horas_historico
      FROM medidas m
      JOIN sensores s ON m.sensor_id = s.id
      WHERE s.estacao_id = 'ESTACAO_B_RECENTE'
    \`);

    const horasHistorico = parseFloat(result.rows[0].horas_historico);
    expect(horasHistorico).toBeLessThan(24);
    // Em um cenário real, o serviço usaria essa lógica para retornar erro de IQAr indisponível
  });
});
