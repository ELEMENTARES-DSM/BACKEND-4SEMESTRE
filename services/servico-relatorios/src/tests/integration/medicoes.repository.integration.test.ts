import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { pool } from "../../config/db";
import {
  buscarLoteMedicoes,
  buscarMedicoes,
  ChaveLote,
  contarMedicoes,
  existeEstacaoNoMunicipio,
  FiltrosMedicoes,
  LinhaMedicao,
} from "../../repositories/medicoes.repository";
import { periodo } from "../../utils/periodo";
import {
  apagarSchema,
  cadastrarEstacao,
  cadastrarMedida,
  cadastrarSensor,
  nomeDeSchema,
  prepararSchemaRelatorios,
} from "./helpers/banco-relatorios";

// TASK 31.01 com PostgreSQL real. Execute com RELATORIOS_TEST_DATABASE_URL.
const integration = process.env.RELATORIOS_TEST_DATABASE_URL ? describe : describe.skip;

const SJC = "São José dos Campos";
const emBrasilia = (dataHora: string) => Date.parse(`${dataHora}:00-03:00`) / 1000;

integration("US-31 · consulta das medições (PostgreSQL)", () => {
  const schema = nomeDeSchema("relatorios_medicoes");
  const dia = periodo("2026-11-06", "2026-11-06");
  const filtrosSjc = (extra: Partial<FiltrosMedicoes> = {}): FiltrosMedicoes => ({
    municipio: SJC,
    ...dia,
    estacoes: null,
    grandezas: null,
    ...extra,
  });

  beforeAll(async () => {
    await prepararSchemaRelatorios(pool, schema);

    const centro = await cadastrarEstacao(pool, "EST-001", SJC, "Centro");
    const sul = await cadastrarEstacao(pool, "EST-002", SJC, "Sul");
    const paulista = await cadastrarEstacao(pool, "EST-SP1", "São Paulo", "Paulista");

    const tempCentro = await cadastrarSensor(pool, centro, "T-01", "Temperatura", "°C");
    const umidCentro = await cadastrarSensor(pool, centro, "U-01", "Umidade Relativa", "%");
    const tempSul = await cadastrarSensor(pool, sul, "T-02", "Temperatura", "°C");
    const tempSp = await cadastrarSensor(pool, paulista, "T-SP", "Temperatura", "°C");

    await cadastrarMedida(pool, tempCentro, { unixtime: emBrasilia("2026-11-05T23:59") });
    await cadastrarMedida(pool, tempCentro, { unixtime: emBrasilia("2026-11-06T00:00") });
    await cadastrarMedida(pool, tempCentro, { unixtime: emBrasilia("2026-11-06T11:05") });
    await cadastrarMedida(pool, tempCentro, { unixtime: emBrasilia("2026-11-06T23:59") });
    await cadastrarMedida(pool, tempCentro, { unixtime: emBrasilia("2026-11-07T00:00") });
    await cadastrarMedida(pool, umidCentro, {
      unixtime: emBrasilia("2026-11-06T11:05"),
      valor: "120.0",
      valorBruto: "120.0",
      valida: false,
    });
    await cadastrarMedida(pool, tempSul, { unixtime: emBrasilia("2026-11-06T11:05") });
    await cadastrarMedida(pool, tempSp, { unixtime: emBrasilia("2026-11-06T11:05") });
  });

  afterAll(async () => {
    await apagarSchema(pool, schema);
  });

  describe("Cenário 4 · isolamento", () => {
    it("deve trazer só as medições do município pedido quando há dois municípios no banco", async () => {
      // Dado
      const filtros = filtrosSjc();

      // Quando
      const linhas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(linhas).toHaveLength(5);
      expect(new Set(linhas.map((l) => l.municipio))).toEqual(new Set([SJC]));
    });

    it("deve dizer que não há estação quando o município não está cadastrado", async () => {
      // Dado
      const municipio = "Atlântida";

      // Quando
      const existe = await existeEstacaoNoMunicipio(municipio);

      // Então
      expect(existe).toBe(false);
      expect(await existeEstacaoNoMunicipio(SJC)).toBe(true);
    });
  });

  describe("período em Brasília", () => {
    it("deve pôr as medidas de 23:59 e de 00:00 no dia certo quando o período é um dia", async () => {
      // Dado
      const filtros = filtrosSjc({ estacoes: ["EST-001"], grandezas: ["Temperatura"] });

      // Quando
      const linhas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(linhas.map((l) => Number(l.unixtime))).toEqual([
        emBrasilia("2026-11-06T00:00"),
        emBrasilia("2026-11-06T11:05"),
        emBrasilia("2026-11-06T23:59"),
      ]);
    });
  });

  describe("filtros de estação e grandeza", () => {
    it("deve trazer só a estação pedida quando filtra por estação", async () => {
      // Dado
      const filtros = filtrosSjc({ estacoes: ["EST-002"] });

      // Quando
      const linhas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(linhas.map((l) => l.estacao_codigo)).toEqual(["EST-002"]);
    });

    it("deve trazer só a grandeza pedida quando filtra por grandeza", async () => {
      // Dado
      const filtros = filtrosSjc({ grandezas: ["Umidade Relativa"] });

      // Quando
      const linhas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(linhas.map((l) => l.sensor_codigo)).toEqual(["U-01"]);
    });

    it("deve combinar os dois filtros quando vêm juntos", async () => {
      // Dado
      const filtros = filtrosSjc({ estacoes: ["EST-001", "EST-002"], grandezas: ["Temperatura"] });

      // Quando
      const total = await contarMedicoes(filtros);

      // Então
      expect(total).toBe(4);
    });
  });

  describe("Cenário 5 · período sem medições", () => {
    it("deve devolver zero quando nenhuma estação enviou leitura no período", async () => {
      // Dado
      const filtros = filtrosSjc(periodo("2026-10-01", "2026-10-02"));

      // Quando
      const total = await contarMedicoes(filtros);
      const linhas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(total).toBe(0);
      expect(linhas).toEqual([]);
    });
  });

  describe("Cenário 6 · medida inválida", () => {
    it("deve trazer a medida com valida = false quando ela foi marcada como inválida", async () => {
      // Dado
      const filtros = filtrosSjc({ grandezas: ["Umidade Relativa"] });

      // Quando
      const [linha] = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Então
      expect(linha).toMatchObject({
        estacao_codigo: "EST-001",
        estacao_nome: "Centro",
        grandeza: "Umidade Relativa",
        unidade: "%",
        valor: "120.000000",
        valida: false,
      });
    });
  });

  describe("paginação e lotes do CSV", () => {
    it("deve trazer a segunda página quando pede a página 2", async () => {
      // Dado
      const filtros = filtrosSjc();
      const todas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });

      // Quando
      const pagina2 = await buscarMedicoes(filtros, { pagina: 2, porPagina: 2 });

      // Então
      expect(pagina2.map((l) => l.id)).toEqual(todas.slice(2, 4).map((l) => l.id));
    });

    it("deve ler cada linha uma vez, sem pular, quando lê em lotes com unixtime empatado", async () => {
      // Dado
      const filtros = filtrosSjc();
      const todas = await buscarMedicoes(filtros, { pagina: 1, porPagina: 500 });
      const lidas: LinhaMedicao[] = [];
      let chave: ChaveLote | null = null;

      // Quando
      for (;;) {
        const lote: LinhaMedicao[] = await buscarLoteMedicoes(filtros, chave, 2);
        lidas.push(...lote);
        if (lote.length < 2) break;
        chave = lote[lote.length - 1];
      }

      // Então
      expect(lidas.map((l) => l.id)).toEqual(todas.map((l) => l.id));
    });
  });
});
