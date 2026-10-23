import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { ConsumeMessage } from "amqplib";
import { Request, Response } from "express";
import {
  ConsumidorRabbitMqTelemetria,
  FILA_VALIDACAO_TELEMETRIA,
  PREFETCH_VALIDACAO_TELEMETRIA,
  configurarConsumidorTelemetria,
} from "../../events/consumers/rabbitmq-telemetria.consumer";
import { processarEventoTelemetria } from "../../services/processar-telemetria.service";
import { calibrarValor } from "../../services/calibracao.service";
import { obterSaude } from "../../controllers/health.controller";
import * as dbModule from "../../config/db";
import logger from "../../utils/logger";
import {
  EventoTelemetriaDTO,
  MedidaRow,
  SensorEventoRow,
} from "../../dto/evento-telemetria.dto";

/**
 * Banco em memória transacional que simula fielmente o comportamento SQL de
 * `estacoes`, `sensores` e `medidas` (incluindo BEGIN/COMMIT/ROLLBACK e
 * ON CONFLICT (sensor_id, unixtime) DO NOTHING) para validar de ponta a ponta
 * todos os cenários da US-17 (Task 17.1).
 */
class FakePostgresTransactionalDb {
  public sensores = new Map<string, SensorEventoRow>();
  public medidas = new Map<string, MedidaRow>();
  public queriesExecutadas: string[] = [];
  public commitsRealizados = 0;
  public rollbacksRealizados = 0;
  public falharNoCommit = false;
  public falharNaSegundaInsercao = false;

  private contadorInsercoesNaTransacao = 0;
  private snapshotMedidas?: Map<string, MedidaRow>;

  public adicionarSensor(sensor: SensorEventoRow): void {
    this.sensores.set(`${sensor.estacao_id}:${sensor.codigo}`, sensor);
  }

  public criarPool() {
    return {
      connect: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          const normalizado = sql.replace(/\s+/g, " ").trim();
          this.queriesExecutadas.push(normalizado);

          if (normalizado === "BEGIN") {
            this.snapshotMedidas = new Map(this.medidas);
            this.contadorInsercoesNaTransacao = 0;
            return { rows: [] };
          }

          if (normalizado === "COMMIT") {
            if (this.falharNoCommit) {
              throw new Error("Falha simulada no COMMIT");
            }
            this.snapshotMedidas = undefined;
            this.commitsRealizados += 1;
            return { rows: [] };
          }

          if (normalizado === "ROLLBACK") {
            if (this.snapshotMedidas) {
              this.medidas = this.snapshotMedidas;
              this.snapshotMedidas = undefined;
            }
            this.rollbacksRealizados += 1;
            return { rows: [] };
          }

          if (normalizado.startsWith("SELECT s.id, s.estacao_id, s.codigo")) {
            const estacaoUuid = params[0] as string;
            const codigos = params[1] as string[];
            const rows: SensorEventoRow[] = [];
            for (const codigo of codigos) {
              const s = this.sensores.get(`${estacaoUuid}:${codigo}`);
              if (s) {
                rows.push({ ...s });
              }
            }
            return { rows };
          }

          if (normalizado.startsWith("INSERT INTO medidas")) {
            this.contadorInsercoesNaTransacao += 1;
            if (
              this.falharNaSegundaInsercao &&
              this.contadorInsercoesNaTransacao === 2
            ) {
              throw new Error("Falha simulada na segunda leitura da transação");
            }

            const [
              sensor_id,
              unixtime,
              valor_bruto,
              valor,
              valida,
              staging_id,
              criado_em,
            ] = params as [
              string,
              number,
              number | string,
              string,
              boolean,
              string,
              string,
            ];

            const chave = `${sensor_id}:${unixtime}`;
            if (this.medidas.has(chave)) {
              // ON CONFLICT (sensor_id, unixtime) DO NOTHING
              return { rows: [] };
            }

            const nova: MedidaRow = {
              id: `medida-${this.medidas.size + 1}`,
              sensor_id,
              unixtime: String(unixtime),
              valor_bruto: Number(valor_bruto).toFixed(6),
              valor: Number(valor).toFixed(6),
              valida,
              staging_id,
              criado_em,
            };
            this.medidas.set(chave, nova);
            return { rows: [nova] };
          }

          if (
            normalizado.startsWith(
              "SELECT id, sensor_id, unixtime, valor_bruto, valor, valida, staging_id, criado_em FROM medidas",
            )
          ) {
            const [sensor_id, unixtime] = params as [string, number];
            const chave = `${sensor_id}:${unixtime}`;
            const existente = this.medidas.get(chave);
            return { rows: existente ? [existente] : [] };
          }

          return { rows: [] };
        },
        release: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
      }),
    };
  }
}

describe("US-17 (Task 17.1) — Cenários 1 a 13 de ponta a ponta", () => {
  let fakeDb: FakePostgresTransactionalDb;

  beforeEach(() => {
    jest.restoreAllMocks();
    fakeDb = new FakePostgresTransactionalDb();
    fakeDb.adicionarSensor({
      id: "11111111-1111-4111-8111-111111111111",
      estacao_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      codigo: "TEMP-01",
      fator: "1.005000",
      ganho: "-0.025000",
      status: "Ativo",
      tipo: "Temperatura",
      municipio: "São José dos Campos",
      estacao_status: "Ativa",
    });
    fakeDb.adicionarSensor({
      id: "22222222-2222-4222-8222-222222222222",
      estacao_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      codigo: "UMID-01",
      fator: "1.000000",
      ganho: "0.000000",
      status: "Ativo",
      tipo: "Umidade Relativa",
      municipio: "São José dos Campos",
      estacao_status: "Ativa",
    });
  });

  it("Cenário 1: Consome a fila validacao.telemetria com prefetch máximo de 10 eventos sem confirmação", async () => {
    const channel = Object.assign(new EventEmitter(), {
      checkQueue: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({
          queue: FILA_VALIDACAO_TELEMETRIA,
        }),
      prefetch: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
      consume: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ consumerTag: "tag-1" }),
      ack: jest.fn<(...args: unknown[]) => void>(),
      nack: jest.fn<(...args: unknown[]) => void>(),
      close: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    });
    const connection = Object.assign(new EventEmitter(), {
      createChannel: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(channel),
      close: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(undefined),
    });

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: (async () => connection) as never,
    });

    await consumidor.iniciar();

    expect(PREFETCH_VALIDACAO_TELEMETRIA).toBe(10);
    expect(channel.prefetch).toHaveBeenCalledWith(10);
    expect(channel.consume).toHaveBeenCalledWith(
      "validacao.telemetria",
      expect.any(Function),
      { noAck: false },
    );

    await consumidor.encerrar();
  });

  it("Cenário 2: Calibra (bruto * fator) + ganho em BigInt escala 6 com arredondamento HALF_UP para 2 casas", () => {
    // 35.85 * 1.005 + (-0.025) = 36.02925 - 0.025 = 36.00425 -> 36.00
    expect(calibrarValor(35.85, "1.005000", "-0.025000")).toBe("36.00");
    // Empate positivo 2.345 -> 2.35 (HALF_UP)
    expect(calibrarValor(2.345, "1.000000", "0.000000")).toBe("2.35");
    // Empate negativo -2.345 -> -2.35 (HALF_UP afastando-se de zero)
    expect(calibrarValor(-2.345, "1.000000", "0.000000")).toBe("-2.35");
  });

  it("Cenários 3 e 4: Grava em medidas uma linha por leitura, preservando valor_bruto, valor calibrado, unixtime da estação, staging_id e criado_em UTC", async () => {
    const agoraUtc = new Date("2026-10-20T13:10:00.000Z");
    const evento: EventoTelemetriaDTO = {
      staging_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      unixtime: 1792401000,
      leituras: [
        { sensor: "TEMP-01", valor: 35.85 },
        { sensor: "UMID-01", valor: 62.345 },
      ],
    };

    const resultado = await processarEventoTelemetria(evento, {
      dbPool: fakeDb.criarPool() as never,
      agora: () => agoraUtc,
    });

    expect(resultado.inseridas).toBe(2);
    expect(fakeDb.medidas.size).toBe(2);

    const medidaTemp = fakeDb.medidas.get(
      "11111111-1111-4111-8111-111111111111:1792401000",
    )!;
    expect(medidaTemp.valor_bruto).toBe("35.850000");
    expect(medidaTemp.valor).toBe("36.000000");
    expect(medidaTemp.unixtime).toBe("1792401000");
    expect(medidaTemp.staging_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(medidaTemp.valida).toBe(true);
    expect(medidaTemp.criado_em).toBe("2026-10-20T13:10:00.000Z");

    const medidaUmid = fakeDb.medidas.get(
      "22222222-2222-4222-8222-222222222222:1792401000",
    )!;
    expect(medidaUmid.valor_bruto).toBe("62.345000");
    expect(medidaUmid.valor).toBe("62.350000");
  });

  it("Cenário 5: Executa uma transação por evento e desfaz todas as leituras (ROLLBACK) se uma leitura falhar", async () => {
    fakeDb.falharNaSegundaInsercao = true;

    const evento: EventoTelemetriaDTO = {
      staging_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      unixtime: 1792401000,
      leituras: [
        { sensor: "TEMP-01", valor: 25.0 },
        { sensor: "UMID-01", valor: 50.0 },
      ],
    };

    await expect(
      processarEventoTelemetria(evento, {
        dbPool: fakeDb.criarPool() as never,
      }),
    ).rejects.toThrow("Falha simulada na segunda leitura da transação");

    expect(fakeDb.commitsRealizados).toBe(0);
    expect(fakeDb.rollbacksRealizados).toBe(1);
    expect(fakeDb.medidas.size).toBe(0);
  });

  it("Cenário 6: Envia ack no RabbitMQ somente após o COMMIT no banco; não envia ack se o COMMIT falhar", async () => {
    let handlerMensagem: ((msg: ConsumeMessage | null) => void) | undefined;
    const passos: string[] = [];

    const channel = Object.assign(new EventEmitter(), {
      checkQueue: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        queue: FILA_VALIDACAO_TELEMETRIA,
      }),
      prefetch: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      consume: jest
        .fn<
          (
            q: string,
            cb: (msg: ConsumeMessage | null) => void,
          ) => Promise<{ consumerTag: string }>
        >()
        .mockImplementation(async (_q, cb) => {
          handlerMensagem = cb;
          return { consumerTag: "ctag" };
        }),
      ack: jest.fn<(...args: unknown[]) => void>(() => {
        passos.push(`ack:commits=${fakeDb.commitsRealizados}`);
      }),
      nack: jest.fn<(...args: unknown[]) => void>(() => {
        passos.push(`nack:commits=${fakeDb.commitsRealizados}`);
      }),
      close: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    });

    const connection = Object.assign(new EventEmitter(), {
      createChannel: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(channel),
      close: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    });

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: (async () => connection) as never,
      processarEvento: (evento) =>
        processarEventoTelemetria(evento, {
          dbPool: fakeDb.criarPool() as never,
        }),
    });

    await consumidor.iniciar();

    const msgSucesso = {
      content: Buffer.from(
        JSON.stringify({
          staging_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          unixtime: 1792402000,
          leituras: [{ sensor: "TEMP-01", valor: 25.0 }],
        }),
      ),
    } as ConsumeMessage;

    handlerMensagem!(msgSucesso);
    await new Promise((r) => setTimeout(r, 20));

    expect(passos).toEqual(["ack:commits=1"]);

    // Agora simula falha no COMMIT: ack não pode ser chamado
    fakeDb.falharNoCommit = true;
    const msgFalha = {
      content: Buffer.from(
        JSON.stringify({
          staging_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          unixtime: 1792402060,
          leituras: [{ sensor: "TEMP-01", valor: 26.0 }],
        }),
      ),
    } as ConsumeMessage;

    handlerMensagem!(msgFalha);
    await new Promise((r) => setTimeout(r, 20));

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(msgFalha, false, true);

    await consumidor.encerrar();
  });

  it("Cenários 7 e 8: Busca sensores em uma única query por evento sem cache e obtém município via sensores -> estacoes", async () => {
    const evento1: EventoTelemetriaDTO = {
      staging_id: "staging-1",
      estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      unixtime: 1792403000,
      leituras: [
        { sensor: "TEMP-01", valor: 20.0 },
        { sensor: "UMID-01", valor: 50.0 },
      ],
    };

    await processarEventoTelemetria(evento1, {
      dbPool: fakeDb.criarPool() as never,
    });

    const selectsSensores = fakeDb.queriesExecutadas.filter((q) =>
      q.startsWith("SELECT s.id, s.estacao_id, s.codigo"),
    );
    expect(selectsSensores).toHaveLength(1);
    expect(selectsSensores[0]).toContain("JOIN estacoes e ON e.id = s.estacao_id");
    expect(selectsSensores[0]).toContain("e.municipio");

    // Altera fator/ganho do sensor no banco e envia novo evento: como não há cache, usa os novos parâmetros imediatamente
    fakeDb.adicionarSensor({
      id: "11111111-1111-4111-8111-111111111111",
      estacao_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      codigo: "TEMP-01",
      fator: "2.000000",
      ganho: "1.000000",
      status: "Ativo",
      tipo: "Temperatura",
      municipio: "São José dos Campos",
      estacao_status: "Ativa",
    });

    await processarEventoTelemetria(
      {
        ...evento1,
        staging_id: "staging-2",
        unixtime: 1792403060,
        leituras: [{ sensor: "TEMP-01", valor: 20.0 }],
      },
      { dbPool: fakeDb.criarPool() as never },
    );

    const novaMedida = fakeDb.medidas.get(
      "11111111-1111-4111-8111-111111111111:1792403060",
    )!;
    // 20 * 2 + 1 = 41.00
    expect(novaMedida.valor).toBe("41.000000");
    // Confirma que a linha em medidas não duplica a coluna municipio
    expect("municipio" in novaMedida).toBe(false);
  });

  it("Cenários 9 e 10: Idempotência UNIQUE (sensor_id, unixtime) mantém a primeira medida e registra divergência em log apenas se valor_bruto mudar", async () => {
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});

    const eventoOriginal: EventoTelemetriaDTO = {
      staging_id: "staging-original",
      estacao_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      unixtime: 1792404000,
      leituras: [{ sensor: "TEMP-01", valor: 25.0 }],
    };

    // 1ª entrega: insere normalmente
    const r1 = await processarEventoTelemetria(eventoOriginal, {
      dbPool: fakeDb.criarPool() as never,
    });
    expect(r1.inseridas).toBe(1);

    // 2ª entrega com MESMO valor_bruto: mantém a primeira e não loga divergência
    const r2 = await processarEventoTelemetria(
      { ...eventoOriginal, staging_id: "staging-dup-igual" },
      { dbPool: fakeDb.criarPool() as never },
    );
    expect(r2.inseridas).toBe(0);
    expect(r2.duplicadasIdempotentes).toBe(1);
    expect(r2.duplicadasDivergentes).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();

    // 3ª entrega com valor_bruto DIFERENTE: mantém a primeira (25.0) e registra divergência em log
    const r3 = await processarEventoTelemetria(
      {
        ...eventoOriginal,
        staging_id: "staging-dup-divergente",
        leituras: [{ sensor: "TEMP-01", valor: 29.75 }],
      },
      { dbPool: fakeDb.criarPool() as never },
    );
    expect(r3.inseridas).toBe(0);
    expect(r3.duplicadasIdempotentes).toBe(0);
    expect(r3.duplicadasDivergentes).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const medidaPersistida = fakeDb.medidas.get(
      "11111111-1111-4111-8111-111111111111:1792404000",
    )!;
    expect(medidaPersistida.valor_bruto).toBe("25.000000");
    expect(medidaPersistida.staging_id).toBe("staging-original");
  });

  it("Cenário 11: Migration própria (pgmigrations_validacao) cria medidas com todas as colunas e nunca apaga medidas no down", () => {
    const pkgPath = path.resolve(__dirname, "../../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts: { migrate: string };
    };
    expect(pkg.scripts.migrate).toContain("--migrations-table pgmigrations_validacao");

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1792502100000_create-medidas-table.cjs");
    const sqlsUp: string[] = [];
    const sqlsDown: string[] = [];

    migration.up({ sql: (s: string) => sqlsUp.push(s) });
    migration.down({ sql: (s: string) => sqlsDown.push(s) });

    const sqlCompletoUp = sqlsUp.join("\n");
    expect(sqlCompletoUp).toContain("CREATE TABLE IF NOT EXISTS medidas");
    expect(sqlCompletoUp).toContain("id          UUID          PRIMARY KEY DEFAULT gen_random_uuid()");
    expect(sqlCompletoUp).toContain("sensor_id   UUID          NOT NULL REFERENCES sensores(id)");
    expect(sqlCompletoUp).toContain("unixtime    BIGINT        NOT NULL");
    expect(sqlCompletoUp).toContain("valor_bruto NUMERIC(18,6) NOT NULL");
    expect(sqlCompletoUp).toContain("valor       NUMERIC(12,6) NOT NULL");
    expect(sqlCompletoUp).toContain("valida      BOOLEAN       NOT NULL DEFAULT TRUE");
    expect(sqlCompletoUp).toContain("staging_id  UUID          NOT NULL");
    expect(sqlCompletoUp).toContain("criado_em   TIMESTAMP     NOT NULL");
    expect(sqlCompletoUp).toContain("UNIQUE (sensor_id, unixtime)");
    expect(sqlCompletoUp).not.toContain("municipio");

    // Nunca apaga medidas no down
    expect(sqlsDown.join("\n").toUpperCase()).not.toContain("DROP TABLE");
  });

  it("Cenários 12 e 13: Se a fila não existir, tenta novamente sem encerrar o serviço e reflete no GET /validacao/health", async () => {
    jest.spyOn(dbModule, "verificarConexaoBanco").mockResolvedValue(true);

    let filaCriada = false;
    const channel = Object.assign(new EventEmitter(), {
      checkQueue: jest.fn<() => Promise<unknown>>().mockImplementation(async () => {
        if (!filaCriada) {
          throw new Error("NOT_FOUND - queue 'validacao.telemetria' inexistente");
        }
        return { queue: FILA_VALIDACAO_TELEMETRIA };
      }),
      prefetch: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
      consume: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ consumerTag: "ctag" }),
      ack: jest.fn(),
      nack: jest.fn(),
      close: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    });

    const connection = Object.assign(new EventEmitter(), {
      createChannel: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(channel),
      close: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
    });

    const consumidor = new ConsumidorRabbitMqTelemetria({
      url: "amqp://localhost:5672",
      conectar: (async () => connection) as never,
      reconectarMs: 30,
    });
    configurarConsumidorTelemetria(consumidor);

    await consumidor.iniciar();

    const criarRes = () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      return res as unknown as Response & {
        status: jest.Mock;
        json: jest.Mock;
      };
    };

    // Enquanto a fila não existe: health responde 503 com fila: "indisponivel"
    const resAntes = criarRes();
    await obterSaude({} as Request, resAntes);
    expect(resAntes.status).toHaveBeenCalledWith(503);
    expect(resAntes.json).toHaveBeenCalledWith({
      status: "indisponivel",
      conexoes: {
        postgres: "conectado",
        rabbitmq: "conectado",
      },
      fila: "indisponivel",
    });

    // Agora a fila passa a existir (criada pela US-15)
    filaCriada = true;
    await new Promise((r) => setTimeout(r, 60));

    const resDepois = criarRes();
    await obterSaude({} as Request, resDepois);
    expect(resDepois.status).toHaveBeenCalledWith(200);
    expect(resDepois.json).toHaveBeenCalledWith({
      status: "ok",
      conexoes: {
        postgres: "conectado",
        rabbitmq: "conectado",
      },
      fila: "disponivel",
    });

    await consumidor.encerrar();
    configurarConsumidorTelemetria(undefined);
  });
});
