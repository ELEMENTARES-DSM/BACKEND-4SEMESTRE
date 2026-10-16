import { PoolClient } from "pg";

export interface AtualizarSinalEstacaoInput {
  estacaoId: string;
  ultimoPing: string;
  nivelBateria?: number;
}

export async function atualizarSinalEstacao(
  client: PoolClient,
  dados: AtualizarSinalEstacaoInput,
): Promise<boolean> {
  if (dados.nivelBateria !== undefined) {
    const res = await client.query(
      `
      UPDATE estacoes
      SET 
        ultimo_ping = $1,
        nivel_bateria = $2
      WHERE id = $3
      `,
      [dados.ultimoPing, dados.nivelBateria, dados.estacaoId],
    );
    return (res.rowCount ?? 0) > 0;
  } else {
    const res = await client.query(
      `
      UPDATE estacoes
      SET 
        ultimo_ping = $1
      WHERE id = $2
      `,
      [dados.ultimoPing, dados.estacaoId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
