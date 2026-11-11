import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER || 'fatec'}:${process.env.DB_PASS || process.env.DB_PASSWORD || 'fatec'}@${process.env.DB_HOST}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'elementares'}`
    : 'postgresql://fatec:fatec@localhost:5432/elementares');

describe('Seeds Integration: seed-historico-30-dias.sql', () => {
  let pool: Pool;
  let bancoDisponivel = false;
  const seedPath = path.resolve(__dirname, '../database/seeds/seed-historico-30-dias.sql');
  const fallbackPath = path.resolve(__dirname, '../db/seeds/seed-historico-30-dias.sql');
  const pathToLoad = fs.existsSync(seedPath) ? seedPath : fallbackPath;

  beforeAll(async () => {
    pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 2000,
    });

    try {
      await pool.query('SELECT 1');
      bancoDisponivel = true;
    } catch {
      bancoDisponivel = false;
    }

    if (bancoDisponivel) {
      // 1. Limpar registros anteriores de teste
      await pool.query(`
        DELETE FROM medidas WHERE sensor_id IN (
          SELECT id FROM sensores WHERE estacao_id IN (
            SELECT id FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
          )
        )
      `);
      await pool.query(`
        DELETE FROM sensores WHERE estacao_id IN (
          SELECT id FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
        )
      `);
      await pool.query(`
        DELETE FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
      `);

      // 2. Executar o script SQL do seed
      const seedSql = fs.readFileSync(pathToLoad, 'utf-8');
      await pool.query(seedSql);
    }
  });

  afterAll(async () => {
    if (bancoDisponivel && pool) {
      try {
        await pool.query(`
          DELETE FROM medidas WHERE sensor_id IN (
            SELECT id FROM sensores WHERE estacao_id IN (
              SELECT id FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
            )
          )
        `);
        await pool.query(`
          DELETE FROM sensores WHERE estacao_id IN (
            SELECT id FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
          )
        `);
        await pool.query(`
          DELETE FROM estacoes WHERE codigo IN ('EST-HIST-01', 'EST-REC-02')
        `);
      } finally {
        await pool.end();
      }
    } else if (pool) {
      await pool.end();
    }
  });

  it('deve carregar o arquivo de seed SQL válido e estruturado', () => {
    expect(fs.existsSync(pathToLoad)).toBe(true);
    const sql = fs.readFileSync(pathToLoad, 'utf-8');
    expect(sql).toContain('EST-HIST-01');
    expect(sql).toContain('EST-REC-02');
    expect(sql).toContain('PM2.5');
    expect(sql).toContain('Umidade Relativa');
    expect(sql).toContain('valida');
    expect(sql).toContain('false');
    expect(sql).toContain('INTERVAL \'30 days\'');
    expect(sql).toContain('INTERVAL \'12 hours\'');
  });

  it('deve popular o banco com a volumetria correta de 30 dias e estação recente', async () => {
    if (!bancoDisponivel) {
      return;
    }

    // Estação A: 30 dias * 24 horas = ~721 horas. 3 sensores = ~2163 medidas válidas + 31 inválidas (> 2100)
    const resultEstacaoA = await pool.query(`
      SELECT COUNT(*) as total 
      FROM medidas m 
      JOIN sensores s ON m.sensor_id = s.id 
      JOIN estacoes e ON s.estacao_id = e.id
      WHERE e.codigo = 'EST-HIST-01'
    `);
    const totalA = parseInt(resultEstacaoA.rows[0].total, 10);
    expect(totalA).toBeGreaterThan(2100);

    // Estação B: 12 horas * 2 sensores = ~26 medidas
    const resultEstacaoB = await pool.query(`
      SELECT COUNT(*) as total 
      FROM medidas m 
      JOIN sensores s ON m.sensor_id = s.id 
      JOIN estacoes e ON s.estacao_id = e.id
      WHERE e.codigo = 'EST-REC-02'
    `);
    const totalB = parseInt(resultEstacaoB.rows[0].total, 10);
    expect(totalB).toBeGreaterThanOrEqual(24);
  });

  it('deve desconsiderar registros com valida = false no cálculo de médias e agregação de IQAr', async () => {
    if (!bancoDisponivel) {
      return;
    }

    // Consulta calculando média apenas das medidas válidas vs média geral (com os 9999 inválidos)
    const result = await pool.query(`
      SELECT 
        AVG(CASE WHEN m.valida = true THEN m.valor ELSE NULL END) as media_valida,
        AVG(m.valor) as media_geral,
        COUNT(CASE WHEN m.valida = false THEN 1 ELSE NULL END) as total_invalidas
      FROM medidas m
      JOIN sensores s ON m.sensor_id = s.id
      JOIN estacoes e ON s.estacao_id = e.id
      WHERE e.codigo = 'EST-HIST-01' AND s.tipo = 'PM2.5'
    `);

    const mediaValida = parseFloat(result.rows[0].media_valida);
    const mediaGeral = parseFloat(result.rows[0].media_geral);
    const totalInvalidas = parseInt(result.rows[0].total_invalidas, 10);

    // Deve conter medições com valida = false
    expect(totalInvalidas).toBeGreaterThan(0);
    // A média válida deve estar dentro do range normal gerado (10 a 50 ug/m3)
    expect(mediaValida).toBeLessThan(100);
    expect(mediaValida).toBeGreaterThanOrEqual(10);
    // A média geral deve ser muito maior que a média válida devido ao valor espúrio 9999
    expect(mediaGeral).toBeGreaterThan(mediaValida);
  });

  it('deve identificar estação recém-instalada com dados insuficientes (< 24h) para o IQAr', async () => {
    if (!bancoDisponivel) {
      return;
    }

    const result = await pool.query(`
      SELECT 
        MIN(to_timestamp(m.unixtime)) as primeira_medida,
        MAX(to_timestamp(m.unixtime)) as ultima_medida,
        EXTRACT(EPOCH FROM (MAX(to_timestamp(m.unixtime)) - MIN(to_timestamp(m.unixtime)))) / 3600 as horas_historico
      FROM medidas m
      JOIN sensores s ON m.sensor_id = s.id
      JOIN estacoes e ON s.estacao_id = e.id
      WHERE e.codigo = 'EST-REC-02'
    `);

    const horasHistorico = parseFloat(result.rows[0].horas_historico);
    expect(horasHistorico).toBeLessThan(24);
  });
});
