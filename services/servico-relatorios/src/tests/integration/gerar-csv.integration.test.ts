import { Writable } from "node:stream";
import { describe, it, expect, jest, beforeAll, afterAll, afterEach } from "@jest/globals";
import { pool } from "../../config/db";
import * as repositorio from "../../repositories/medicoes.repository";
import { escreverCsv } from "../../services/gerar-csv.service";
import { BOM, CABECALHO_CSV } from "../../utils/formatar-csv";
import { periodo } from "../../utils/periodo";
import {
  apagarSchema,
  cadastrarEstacao,
  cadastrarSensor,
  cadastrarSerie,
  nomeDeSchema,
  prepararSchemaRelatorios,
} from "./helpers/banco-relatorios";

// TASK 31.02 com PostgreSQL real. Execute com RELATORIOS_TEST_DATABASE_URL.
const integration = process.env.RELATORIOS_TEST_DATABASE_URL ? describe : describe.skip;

// Saída lenta e com buffer pequeno, para o `write` devolver false e o serviço esperar o `drain`.
function saidaLenta(): { saida: Writable; texto: () => Promise<string> } {
  const partes: Buffer[] = [];
  const saida = new Writable({
    highWaterMark: 1024,
    write(parte: Buffer, _codificacao, pronto) {
      partes.push(parte);
      setImmediate(pronto);
    },
  });
  // Fecha a saída e devolve tudo o que foi escrito.
  const texto = () =>
    new Promise<string>((resolve) => saida.end(() => resolve(Buffer.concat(partes).toString("utf8"))));
  return { saida, texto };
}

integration("US-31 · CSV em lotes (PostgreSQL)", () => {
  const schema = nomeDeSchema("relatorios_csv");
  const filtros = (dias: { inicio: string; fim: string }): repositorio.FiltrosMedicoes => ({
    municipio: "São José dos Campos",
    ...periodo(dias.inicio, dias.fim),
    estacoes: null,
    grandezas: null,
  });

  beforeAll(async () => {
    await prepararSchemaRelatorios(pool, schema);
    const estacao = await cadastrarEstacao(pool, "EST-001");
    const inicio = Date.parse("2026-11-01T00:00:00-03:00") / 1000;
    // Dois sensores com os mesmos horários: 12.000 medidas com unixtime empatado aos pares.
    await cadastrarSerie(pool, await cadastrarSensor(pool, estacao, "T-01"), inicio, 6000);
    await cadastrarSerie(pool, await cadastrarSensor(pool, estacao, "U-01", "Umidade Relativa", "%"), inicio, 6000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await apagarSchema(pool, schema);
  });

  it("deve escrever 12.001 linhas em 3 lotes, sem repetir linha, quando há 12.000 medidas", async () => {
    // Dado
    const lotes = jest.spyOn(repositorio, "buscarLoteMedicoes");
    const { saida, texto } = saidaLenta();

    // Quando
    await escreverCsv(filtros({ inicio: "2026-11-01", fim: "2026-11-06" }), saida);

    // Então
    const linhas = (await texto()).split("\r\n").slice(0, -1);
    expect(linhas).toHaveLength(12001);
    expect(new Set(linhas).size).toBe(12001);
    expect(lotes).toHaveBeenCalledTimes(3);
    // No mesmo minuto, a ordem entre os dois sensores segue o id (UUID), que é arbitrário.
    expect(linhas[1]).toMatch(/^01\/11\/2026 00:00;EST-001;Centro;São José dos Campos;[TU]-01;.+;20;21;Sim$/);
  });

  it("deve escrever só o cabeçalho quando o período não tem medições", async () => {
    // Dado
    const { saida, texto } = saidaLenta();

    // Quando
    await escreverCsv(filtros({ inicio: "2026-10-01", fim: "2026-10-01" }), saida);

    // Então
    expect(await texto()).toBe(`${BOM}${CABECALHO_CSV}\r\n`);
  });
});
