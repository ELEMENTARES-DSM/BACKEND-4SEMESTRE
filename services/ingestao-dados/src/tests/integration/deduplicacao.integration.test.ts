import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { encerrarValkey, valkey } from "../../config/valkey";
import { MensagemBruta } from "../../dto/mensagem-ingestao.dto";
import {
  chaveMensagem,
  chaveVisto,
  expiraEm,
  gravarBruta,
  lerMensagem,
  LISTA_PENDENTES,
  marcarVisto,
} from "../../repositories/staging-valkey.repository";
import { verificarMensagem } from "../../services/processar-mensagem.service";
import { logger } from "../../utils/logger";
import { cadastrarEstacao, criarTabelaEstacoes } from "./helpers/estacoes";
import { gravarEVerificar, usarValkeyDeTeste } from "./helpers/valkey";

// US-13 (TASK 40.04): duplicata por estação e horário na chave
// staging:visto:{estacao}:{unixtime} do Valkey, com SET NX GET PXAT de verdade.
// O PostgreSQL de teste só tem a tabela estacoes, num schema isolado.
const integration =
  process.env.STAGING_TEST_DATABASE_URL && process.env.VALKEY_TEST_URL ? describe : describe.skip;

const AGORA = new Date("2026-11-16T10:00:00.000Z");
const segundos = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

integration("US-13 · duplicata pela chave staging:visto no Valkey", () => {
  const schema = `dedup_test_${randomUUID().replaceAll("-", "")}`;

  const mensagem = (
    estacaoId: string,
    timestamp: string,
    extras: Partial<MensagemBruta> = {},
  ): MensagemBruta => ({
    topico: `pulso/estacoes/${estacaoId}/telemetria`,
    recebidoEm: "2026-10-15T00:00:05Z",
    payloadBruto: `{ "timestamp":"${timestamp}", "leituras":[{"sensor":"temperatura","valor":25}] }`,
    ...extras,
  });

  const novaEstacao = async (): Promise<string> => {
    const id = randomUUID();
    await cadastrarEstacao(pool, id);
    return id;
  };

  const pendentes = async (): Promise<number> => valkey().lLen(LISTA_PENDENTES);

  beforeAll(async () => {
    // O módulo db é carregado antes dos hooks: configurar o pool explicitamente.
    pool.options.connectionString = process.env.STAGING_TEST_DATABASE_URL;
    pool.options.options = `-c search_path=${schema}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    await criarTabelaEstacoes(pool);
    await usarValkeyDeTeste(2);
  });

  afterAll(async () => {
    try {
      await valkey().flushDb();
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
      await encerrarValkey();
    }
  });

  beforeEach(async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    await valkey().flushDb();
  });

  describe("marcarVisto · SET NX GET PXAT no Valkey real", () => {
    it("deve devolver nova e gravar o id com expiração 7 dias depois do agora quando a chave não existe", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();

      // Quando (Act)
      const resultado = await marcarVisto(estacaoId, 1792400000, "id-1", AGORA);

      // Então (Assert)
      expect(resultado).toBe("nova");
      expect(await valkey().get(chaveVisto(estacaoId, 1792400000))).toBe("id-1");
      expect(await valkey().pExpireTime(chaveVisto(estacaoId, 1792400000))).toBe(expiraEm(AGORA).getTime());
    });

    it("deve devolver nova e manter a chave quando o mesmo id marca de novo", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await marcarVisto(estacaoId, 1792400000, "id-1", AGORA);

      // Quando (Act)
      const resultado = await marcarVisto(estacaoId, 1792400000, "id-1", new Date(AGORA.getTime() + 60000));

      // Então (Assert)
      expect(resultado).toBe("nova");
      expect(await valkey().pExpireTime(chaveVisto(estacaoId, 1792400000))).toBe(expiraEm(AGORA).getTime());
    });

    it("deve devolver duplicada sem trocar o id nem a expiração quando outro id marca a mesma chave", async () => {
      // Dado (Arrange)
      const estacaoId = randomUUID();
      await marcarVisto(estacaoId, 1792400000, "id-original", AGORA);

      // Quando (Act)
      const resultado = await marcarVisto(estacaoId, 1792400000, "id-copia", new Date(AGORA.getTime() + 60000));

      // Então (Assert)
      expect(resultado).toBe("duplicada");
      expect(await valkey().get(chaveVisto(estacaoId, 1792400000))).toBe("id-original");
      expect(await valkey().pExpireTime(chaveVisto(estacaoId, 1792400000))).toBe(expiraEm(AGORA).getTime());
    });
  });

  describe("US-40 · Cenário 5 · a mesma leitura chega 2 vezes e segue 1 vez só", () => {
    it("deve deixar a original pendente e a repetição duplicada quando a estação e o timestamp se repetem", async () => {
      // Dado (Arrange)
      const estacaoId = await novaEstacao();
      const original = mensagem(estacaoId, "2026-10-15T00:00:00Z");
      // Reenvio com outro horário de recebimento e outro espaçamento, mesmo timestamp.
      const reenvio = mensagem(estacaoId, "2026-10-15T00:00:00Z", {
        recebidoEm: "2026-10-15T00:00:30Z",
        payloadBruto: '{"timestamp":"2026-10-15T00:00:00Z","leituras":[{"sensor":"temperatura","valor":25}]}',
      });
      expect(await gravarEVerificar(original)).toBe("pendente");
      const [idOriginal] = await valkey().lRange(LISTA_PENDENTES, 0, -1);

      // Quando (Act)
      const resultado = await gravarEVerificar(reenvio);

      // Então (Assert)
      expect(resultado).toBe("duplicada");
      expect(await valkey().lRange(LISTA_PENDENTES, 0, -1)).toEqual([idOriginal]);
      expect(await valkey().get(chaveVisto(estacaoId, segundos("2026-10-15T00:00:00Z")))).toBe(idOriginal);
      expect(await lerMensagem(idOriginal)).toMatchObject({ status: "pendente", payloadBruto: original.payloadBruto });
    });
  });

  it("deve marcar duplicada no Valkey, sem motivo e com expiração, quando a leitura se repete", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));
    const id = await gravarBruta(mensagem(estacaoId, "2026-10-15T00:00:00Z"));

    // Quando (Act)
    await verificarMensagem((await lerMensagem(id))!, () => AGORA);

    // Então (Assert)
    const campos = await valkey().hGetAll(chaveMensagem(id));
    expect(campos.status).toBe("duplicada");
    expect(campos.motivo).toBeUndefined();
    expect(await valkey().pExpireTime(chaveMensagem(id))).toBe(expiraEm(AGORA).getTime());
  });

  it("deve tratar como duplicata quando o mesmo instante vem com fuso diferente", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-14T21:00:00-03:00"));

    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    expect(await pendentes()).toBe(1);
  });

  it("deve aceitar as duas quando a mesma estação envia horários diferentes", async () => {
    // Dado (Arrange)
    const estacaoId = await novaEstacao();

    // Quando (Act)
    const primeira = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00Z"));
    const segunda = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:01Z"));

    // Então (Assert)
    expect([primeira, segunda]).toEqual(["pendente", "pendente"]);
    expect(await pendentes()).toBe(2);
  });

  it("deve aceitar as duas quando estações diferentes enviam o mesmo horário", async () => {
    // Dado (Arrange)
    const a = await novaEstacao();
    const b = await novaEstacao();

    // Quando (Act)
    const primeira = await gravarEVerificar(mensagem(a, "2026-10-15T00:00:00Z"));
    const segunda = await gravarEVerificar(mensagem(b, "2026-10-15T00:00:00Z"));

    // Então (Assert)
    expect([primeira, segunda]).toEqual(["pendente", "pendente"]);
    expect(await pendentes()).toBe(2);
  });

  it("deve aceitar só uma quando chegam 10 cópias idênticas ao mesmo tempo", async () => {
    // Dado (Arrange)
    const copia = mensagem(await novaEstacao(), "2026-10-15T00:00:00Z");

    // Quando (Act)
    const resultados = await Promise.all(Array.from({ length: 10 }, () => gravarEVerificar(copia)));

    // Então (Assert)
    expect(resultados.filter((r) => r === "pendente")).toHaveLength(1);
    expect(resultados.filter((r) => r === "duplicada")).toHaveLength(9);
    expect(await pendentes()).toBe(1);
  });

  it("deve tratar como duplicata quando os dois timestamps caem no mesmo segundo", async () => {
    // Dado (Arrange)
    // A chave é o unixtime em segundos, como o de medidas: frações são truncadas.
    const estacaoId = await novaEstacao();
    await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00.200Z"));

    // Quando (Act)
    const resultado = await gravarEVerificar(mensagem(estacaoId, "2026-10-15T00:00:00.700Z"));

    // Então (Assert)
    expect(resultado).toBe("duplicada");
    expect(await pendentes()).toBe(1);
  });

  it("deve aceitar de novo, sem acusar duplicata, quando a mesma mensagem do Valkey é verificada outra vez", async () => {
    // Dado (Arrange)
    // Falha entre marcar visto e marcar pendente: a mensagem continua
    // "recebida" e volta na rodada seguinte com o mesmo id.
    const estacaoId = await novaEstacao();
    const id = await gravarBruta(mensagem(estacaoId, "2026-10-15T00:00:00Z"));
    const staging = (await lerMensagem(id))!;
    await marcarVisto(estacaoId, segundos("2026-10-15T00:00:00Z"), id, AGORA);

    // Quando (Act)
    const resultado = await verificarMensagem(staging);

    // Então (Assert)
    expect(resultado).toBe("pendente");
    expect(await valkey().lRange(LISTA_PENDENTES, 0, -1)).toEqual([id]);
  });
});
