import { pool } from "../config/db";
import {
  Alarme,
  FiltrosAlarme,
  SEVERIDADES_ALARME,
  ResumoAlarmes,
  SeveridadeAlarme,
} from "../models/alarme.model";

// alarmes é do servico-validacao (US-22): aqui só leitura. Sem FK para as tabelas
// dos outros serviços, por isso os nomes vêm de LEFT JOIN.
const SELECT_ALARME = `
  SELECT a.id, a.regra_id, r.nome AS regra_nome,
         a.sensor_id, s.codigo AS sensor_codigo, s.tipo AS sensor_tipo,
         s.unidade_medida AS sensor_unidade_medida,
         a.estacao_id, e.codigo AS estacao_codigo, e.nome AS estacao_nome,
         a.municipio, a.valor, a.operador, a.limite, a.severidade, a.situacao,
         a.lido_em, a.criado_em, a.normalizado_em
  FROM alarmes a
  LEFT JOIN regras_alerta r ON r.id = a.regra_id
  LEFT JOIN sensores s ON s.id = a.sensor_id
  LEFT JOIN estacoes e ON e.id = a.estacao_id`;

export const LIMITE_LISTA_ALARMES = 500;

// municipio = null lista todos os municípios (acesso global).
export const findAll = async (
  filtros: FiltrosAlarme,
  municipio: string | null
): Promise<Alarme[]> => {
  const result = await pool.query<Alarme>(
    `${SELECT_ALARME}
     WHERE ($1::text IS NULL OR a.municipio = $1)
       AND ($2::timestamptz IS NULL OR a.lido_em >= $2)
       AND ($3::timestamptz IS NULL OR a.lido_em <= $3)
       AND ($4::text IS NULL OR a.severidade = $4)
       AND ($5::uuid IS NULL OR a.estacao_id = $5)
       AND ($6::text IS NULL OR a.situacao = $6)
     ORDER BY a.lido_em DESC, a.criado_em DESC
     LIMIT ${LIMITE_LISTA_ALARMES}`,
    [
      municipio,
      filtros.de ?? null,
      filtros.ate ?? null,
      filtros.severidade ?? null,
      filtros.estacao_id ?? null,
      filtros.situacao ?? null,
    ]
  );

  return result.rows;
};

export const findById = async (id: string): Promise<Alarme | null> => {
  const result = await pool.query<Alarme>(`${SELECT_ALARME} WHERE a.id = $1`, [id]);

  return result.rows[0] ?? null;
};

export const resumoAbertos = async (
  municipio: string | null
): Promise<ResumoAlarmes> => {
  const result = await pool.query<{ severidade: SeveridadeAlarme; total: string }>(
    `SELECT severidade, count(*) AS total
     FROM alarmes
     WHERE situacao = 'aberto'
       AND ($1::text IS NULL OR municipio = $1)
     GROUP BY severidade`,
    [municipio]
  );

  const abertos = Object.fromEntries(
    SEVERIDADES_ALARME.map((severidade) => [severidade, 0])
  ) as Record<SeveridadeAlarme, number>;
  for (const linha of result.rows) {
    abertos[linha.severidade] = Number(linha.total);
  }

  return {
    abertos,
    total: Object.values(abertos).reduce((soma, n) => soma + n, 0),
  };
};
