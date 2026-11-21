import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buscarSensoresDaEstacao, lerConfigApi, lerSensoresDeJson } from "../sensores.api.js";
import { daApi } from "./fixtures.js";

const ESTACAO = "11111111-1111-4111-8111-111111111111";
const config = { url: "http://gestao-estacoes:3000", tokenInterno: "token-do-teste" };

interface Chamada {
  url: string;
  token: string | null;
}

/** fetch de mentira: guarda a chamada e responde o que o teste mandar. */
const fetchFalso = (resposta: { status?: number; corpo: unknown }, chamadas: Chamada[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), token: new Headers(init?.headers).get("x-internal-token") });
    return new Response(JSON.stringify(resposta.corpo), {
      status: resposta.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

describe("lerConfigApi (US-39)", () => {
  it("usa o endereço padrão do gestao-estacoes e o token interno", () => {
    assert.deepEqual(lerConfigApi({ INTERNAL_TOKEN: "segredo" }), {
      url: "http://gestao-estacoes:3000",
      tokenInterno: "segredo",
    });
  });

  it("aceita SIM_API_URL e tira a barra do fim", () => {
    const lida = lerConfigApi({ INTERNAL_TOKEN: "segredo", SIM_API_URL: "http://localhost:3000///" });

    assert.equal(lida.url, "http://localhost:3000");
  });

  it("recusa subir sem INTERNAL_TOKEN, dizendo o que configurar", () => {
    assert.throws(() => lerConfigApi({}), /INTERNAL_TOKEN/);
    assert.throws(() => lerConfigApi({ INTERNAL_TOKEN: "   " }), /INTERNAL_TOKEN/);
  });
});

describe("buscarSensoresDaEstacao (US-39)", () => {
  it("chama a rota interna da estação com o token no cabeçalho X-Internal-Token", async () => {
    const chamadas: Chamada[] = [];

    await buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo: [] }, chamadas));

    assert.deepEqual(chamadas, [
      {
        url: `http://gestao-estacoes:3000/api/v1/internal/estacoes/${ESTACAO}/sensores`,
        token: "token-do-teste",
      },
    ]);
  });

  it("devolve os sensores com a faixa e a calibração convertidas (precipitação, pressão e Kelvin)", async () => {
    const corpo = [
      daApi("CHUVA-01", "Precipitação", "mm", 0, 500),
      daApi("PRES-01", "Pressão Atmosférica", "hPa", 600, 1100),
      daApi("TEMP-K", "Temperatura", "°C", -50, 60, { offset: "-273.150000" }),
    ];

    const sensores = await buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo }));

    assert.deepEqual(
      sensores.map((s) => [s.codigo, s.tipo, s.faixaMin, s.faixaMax, s.offset]),
      [
        ["CHUVA-01", "Precipitação", 0, 500, 0],
        ["PRES-01", "Pressão Atmosférica", 600, 1100, 0],
        ["TEMP-K", "Temperatura", -50, 60, -273.15],
      ],
    );
  });

  it("pula o sensor inativo", async () => {
    const corpo = [
      daApi("CHUVA-01", "Precipitação", "mm", 0, 500),
      daApi("PRES-01", "Pressão Atmosférica", "hPa", 600, 1100, { status: "Inativo" }),
    ];

    const sensores = await buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo }));

    assert.deepEqual(sensores.map((s) => s.codigo), ["CHUVA-01"]);
  });

  it("pula o sensor com fator zero, que não dá para inverter, e segue com os outros", async () => {
    const corpo = [
      daApi("RUIM-01", "Temperatura", "°C", -50, 60, { fator_conversao: "0.000000" }),
      daApi("CHUVA-01", "Precipitação", "mm", 0, 500),
    ];
    const aviso = console.warn;
    const avisos: string[] = [];
    console.warn = (...args: unknown[]) => void avisos.push(args.join(" "));

    try {
      const sensores = await buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo }));

      assert.deepEqual(sensores.map((s) => s.codigo), ["CHUVA-01"]);
      assert.match(avisos[0], /RUIM-01/);
    } finally {
      console.warn = aviso;
    }
  });

  it("estação sem sensores devolve lista vazia", async () => {
    assert.deepEqual(await buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo: [] })), []);
  });

  it("falha com o status quando o gestao-estacoes não responde 200 (401, 404)", async () => {
    await assert.rejects(
      buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ status: 401, corpo: { message: "Token interno ausente ou inválido." } })),
      /respondeu 401/,
    );
    await assert.rejects(
      buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ status: 404, corpo: { message: "Estação não encontrada." } })),
      /respondeu 404/,
    );
  });

  it("falha quando a resposta não é uma lista", async () => {
    await assert.rejects(
      buscarSensoresDaEstacao(ESTACAO, config, fetchFalso({ corpo: { message: "ok" } })),
      /Resposta inesperada/,
    );
  });

  it("deixa o erro de rede subir para quem chamou decidir", async () => {
    const fora = (async () => {
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;

    await assert.rejects(buscarSensoresDaEstacao(ESTACAO, config, fora), /ECONNREFUSED/);
  });
});

describe("lerSensoresDeJson (LOTE_SENSORES_JSON, US-39)", () => {
  const OUTRA = "22222222-2222-4222-8222-222222222222";

  it("lê os sensores de várias estações, pulando inativos", () => {
    const texto = JSON.stringify({
      [ESTACAO]: [daApi("CHUVA-01", "Precipitação", "mm", 0, 500), daApi("PRES-01", "Pressão Atmosférica", "hPa", 600, 1100, { status: "Inativo" })],
      [OUTRA]: [daApi("DIR-01", "Direção do Vento", "°", 0, 360)],
    });

    const mapa = lerSensoresDeJson(texto);

    assert.deepEqual(mapa.get(ESTACAO)?.map((s) => s.codigo), ["CHUVA-01"]);
    assert.deepEqual(mapa.get(OUTRA)?.map((s) => s.codigo), ["DIR-01"]);
  });

  it("recusa texto que não é um objeto de listas", () => {
    assert.throws(() => lerSensoresDeJson("[]"), /deve ser um objeto/);
    assert.throws(() => lerSensoresDeJson("null"), /deve ser um objeto/);
    assert.throws(() => lerSensoresDeJson(JSON.stringify({ [ESTACAO]: "nada" })), /Resposta inesperada/);
    assert.throws(() => lerSensoresDeJson("{"), SyntaxError);
  });
});
