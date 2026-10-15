import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import {
  inserirSeNova,
  removerReserva,
} from "../../repositories/mensagem-staging.repository";
import { STATUS_REJEITADA } from "../../models/mensagem-staging.model";
import { PayloadLeituraValidado } from "../../dto/mensagem-ingestao.dto";

// Integração com Postgres real: só roda com DATABASE_URL_TEST (o CI não tem banco).
// Assume que as migrations já rodaram nesse banco.
const DATABASE_URL_TEST = process.env.DATABASE_URL_TEST;
const describeComBanco = DATABASE_URL_TEST ? describe : describe.skip;

describeComBanco("mensagem-staging.repository (integração)", () => {
  let db: Pool;
  const estacoesDoTeste: string[] = [];

  const novaEstacao = (): string => {
    const id = randomUUID();
    estacoesDoTeste.push(id);
    return id;
  };

  const mensagem = (estacaoId: string, timestamp: string) => {
    const payload: PayloadLeituraValidado = {
      timestamp,
      leituras: [{ sensor: "TMP", valor: 25.4 }],
    };
    return {
      estacaoId,
      unixtime: Math.floor(Date.parse(timestamp) / 1000),
      timestampLeitura: new Date(Date.parse(timestamp)),
      payload,
    };
  };

  const contarLinhas = async (estacaoId: string): Promise<number> => {
    const res = await db.query<{ total: string }>(
      "SELECT COUNT(*) AS total FROM mensagens_staging WHERE estacao_uuid = $1",
      [estacaoId],
    );
    return Number(res.rows[0].total);
  };

  beforeAll(() => {
    db = new Pool({ connectionString: DATABASE_URL_TEST });
  });

  afterAll(async () => {
    if (estacoesDoTeste.length > 0) {
      await db.query("DELETE FROM mensagens_staging WHERE estacao_uuid = ANY($1::uuid[])", [
        estacoesDoTeste,
      ]);
    }
    await db.end();
  });

  it("deve gravar uma mensagem nova", async () => {
    const estacao = novaEstacao();

    const id = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:00Z"), db);

    expect(typeof id).toBe("string");
    expect(await contarLinhas(estacao)).toBe(1);
  });

  it("deve retornar null e não criar linha para mesma estação e mesmo timestamp", async () => {
    const estacao = novaEstacao();

    const primeiro = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:00Z"), db);
    const segundo = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:00Z"), db);

    expect(primeiro).not.toBeNull();
    expect(segundo).toBeNull();
    expect(await contarLinhas(estacao)).toBe(1);
  });

  it("deve gravar mesma estação com horário diferente", async () => {
    const estacao = novaEstacao();

    const primeiro = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:00Z"), db);
    const segundo = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:01Z"), db);

    expect(primeiro).not.toBeNull();
    expect(segundo).not.toBeNull();
    expect(await contarLinhas(estacao)).toBe(2);
  });

  it("deve gravar mesmo horário com estação diferente", async () => {
    const estacaoA = novaEstacao();
    const estacaoB = novaEstacao();

    const idA = await inserirSeNova(mensagem(estacaoA, "2026-10-13T12:00:00Z"), db);
    const idB = await inserirSeNova(mensagem(estacaoB, "2026-10-13T12:00:00Z"), db);

    expect(idA).not.toBeNull();
    expect(idB).not.toBeNull();
  });

  it("deve aceitar só 1 de 10 cópias idênticas simultâneas", async () => {
    const estacao = novaEstacao();
    const copia = mensagem(estacao, "2026-10-13T12:00:00Z");

    const ids = await Promise.all(
      Array.from({ length: 10 }, () => inserirSeNova(copia, db)),
    );

    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    expect(await contarLinhas(estacao)).toBe(1);
  });

  it("deve gravar normalmente quando a única linha da mesma chave está rejeitada", async () => {
    const estacao = novaEstacao();
    const msg = mensagem(estacao, "2026-10-13T12:00:00Z");
    await db.query(
      `INSERT INTO mensagens_staging (estacao_uuid, unixtime, timestamp_leitura, payload, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [msg.estacaoId, msg.unixtime, msg.timestampLeitura, JSON.stringify(msg.payload), STATUS_REJEITADA],
    );

    const id = await inserirSeNova(msg, db);

    expect(id).not.toBeNull();
    expect(await contarLinhas(estacao)).toBe(2);
  });

  it("removerReserva deve apagar a linha 'recebida' e permitir gravar a mesma mensagem de novo", async () => {
    const estacao = novaEstacao();
    const msg = mensagem(estacao, "2026-10-13T12:00:00Z");

    const id = await inserirSeNova(msg, db);
    expect(id).not.toBeNull();

    await removerReserva(id as string, db);
    expect(await contarLinhas(estacao)).toBe(0);

    const idReenvio = await inserirSeNova(msg, db);
    expect(idReenvio).not.toBeNull();
    expect(await contarLinhas(estacao)).toBe(1);
  });

  it("removerReserva não deve apagar linha com outro status", async () => {
    const estacao = novaEstacao();
    const id = await inserirSeNova(mensagem(estacao, "2026-10-13T12:00:00Z"), db);
    // Status arbitrário diferente de 'recebida' (a US-14 vai definir os reais).
    await db.query("UPDATE mensagens_staging SET status = 'processada' WHERE id = $1", [id]);

    await removerReserva(id as string, db);

    expect(await contarLinhas(estacao)).toBe(1);
  });
});
