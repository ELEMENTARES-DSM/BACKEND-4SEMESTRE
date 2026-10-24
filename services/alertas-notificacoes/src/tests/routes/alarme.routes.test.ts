import { subir } from "../helpers/servidor-teste";
import app from "../../app";
import * as alarmeRepository from "../../repositories/alarme.repository";
import { Alarme } from "../../models/alarme.model";
import openapi from "../../docs/openapi.json";

jest.mock("../../repositories/alarme.repository");

const repo = jest.mocked(alarmeRepository);

// O exemplo do OpenAPI é o mesmo JSON que a tela usa como fixture (US-24).
const exemplo = openapi.components.schemas.Alarme.example as unknown as Alarme;
const ID = exemplo.id;

const gestorSjc = { papel: "GESTOR_PUBLICO" as const, municipio: "São José dos Campos" };
const gestorSp = { papel: "GESTOR_PUBLICO" as const, municipio: "São Paulo" };
const admin = { papel: "ADMINISTRADOR" as const };
const pesquisador = { papel: "PESQUISADOR" as const };

describe("rotas /alertas/alarmes (US-24)", () => {
  let api: Awaited<ReturnType<typeof subir>>;

  beforeAll(async () => {
    api = await subir(app);
  });

  afterAll(async () => {
    await api.fechar();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repo.findAll.mockResolvedValue([exemplo]);
    repo.findById.mockResolvedValue(exemplo);
    repo.resumoAbertos.mockResolvedValue({ abertos: { ATENCAO: 0, ALERTA: 1, CRITICO: 2 }, total: 3 });
  });

  describe.each([
    ["GET /alertas/alarmes", "/alertas/alarmes"],
    ["GET /alertas/alarmes/resumo", "/alertas/alarmes/resumo"],
    ["GET /alertas/alarmes/:id", `/alertas/alarmes/${ID}`],
  ])("%s", (_nome, caminho) => {
    it("sem login responde 401", async () => {
      const { status, corpo } = await api.get(caminho);

      expect(status).toBe(401);
      expect(corpo).toEqual({ erro: "Autenticação necessária. Token não informado ou formato inválido." });
    });

    it("pesquisador responde 403", async () => {
      const { status, corpo } = await api.get(caminho, pesquisador);

      expect(status).toBe(403);
      expect(corpo).toEqual({ erro: "Acesso negado. Perfil insuficiente para esta ação." });
    });

    it("gestor sem município no token responde 403", async () => {
      const { status } = await api.get(caminho, { papel: "GESTOR_PUBLICO", municipio: null });

      expect(status).toBe(403);
    });
  });

  it("gestor lista só o próprio município, com os filtros validados", async () => {
    const { status, corpo } = await api.get(
      "/alertas/alarmes?severidade=CRITICO&situacao=aberto&de=2026-10-24T00:00:00.000-03:00&ate=2026-10-24T23:59:59.999-03:00",
      gestorSjc
    );

    expect(status).toBe(200);
    expect(corpo).toEqual([exemplo]);
    expect(repo.findAll).toHaveBeenCalledWith(
      {
        severidade: "CRITICO",
        situacao: "aberto",
        de: "2026-10-24T00:00:00.000-03:00",
        ate: "2026-10-24T23:59:59.999-03:00",
      },
      "São José dos Campos"
    );
  });

  it("administrador lista todos os municípios", async () => {
    await api.get("/alertas/alarmes", admin);

    expect(repo.findAll).toHaveBeenCalledWith({}, null);
  });

  it.each([
    ["severidade desconhecida", "severidade=URGENTE", "severidade"],
    ["data sem fuso", "de=2026-10-24", "de"],
    ["estação que não é UUID", "estacao_id=EST-001", "estacao_id"],
    ["situação desconhecida", "situacao=fechado", "situacao"],
    ["período invertido", "de=2026-10-25T00:00:00Z&ate=2026-10-24T00:00:00Z", "ate"],
  ])("filtro inválido (%s) responde 400 sem consultar o banco", async (_caso, query, campo) => {
    const { status, corpo } = await api.get(`/alertas/alarmes?${query}`, gestorSjc);

    expect(status).toBe(400);
    expect(corpo.message).toBe("Dados inválidos");
    expect(Object.keys(corpo.errors)).toEqual([campo]);
    expect(repo.findAll).not.toHaveBeenCalled();
  });

  it("filtro que não existe responde 400", async () => {
    const { status } = await api.get("/alertas/alarmes?municipio=Sao%20Paulo", admin);

    expect(status).toBe(400);
  });

  it("resumo devolve os abertos por severidade do município do gestor", async () => {
    const { status, corpo } = await api.get("/alertas/alarmes/resumo", gestorSjc);

    expect(status).toBe(200);
    expect(corpo).toEqual({ abertos: { ATENCAO: 0, ALERTA: 1, CRITICO: 2 }, total: 3 });
    expect(repo.resumoAbertos).toHaveBeenCalledWith("São José dos Campos");
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it("detalhe do alarme do próprio município responde 200", async () => {
    const { status, corpo } = await api.get(`/alertas/alarmes/${ID}`, gestorSjc);

    expect(status).toBe(200);
    expect(corpo).toEqual(exemplo);
  });

  it("alarme de outro município responde 404 como se não existisse", async () => {
    const { status, corpo } = await api.get(`/alertas/alarmes/${ID}`, gestorSp);

    expect(status).toBe(404);
    expect(corpo).toEqual({ message: "Alarme não encontrado." });
  });

  it("alarme inexistente responde 404 e id que não é UUID responde 400", async () => {
    repo.findById.mockResolvedValue(null);

    expect((await api.get(`/alertas/alarmes/${ID}`, admin)).status).toBe(404);
    expect((await api.get("/alertas/alarmes/abc", admin)).status).toBe(400);
  });
});
