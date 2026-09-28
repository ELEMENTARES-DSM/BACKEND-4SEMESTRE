import * as regraAlertaService from "../../services/regra-alerta.service";
import * as regraAlertaRepository from "../../repositories/regra-alerta.repository";
import { UsuarioPayload } from "../../types/express";
import { RegraAlerta, SensorComEstacao } from "../../models/regra-alerta.model";
import { CreateRegraAlertaDTO } from "../../validations/regra-alerta.validation";

jest.mock("../../repositories/regra-alerta.repository");

const repo = jest.mocked(regraAlertaRepository);

const SENSOR_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const REGRA_ID = "7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

const gestor: UsuarioPayload = {
  id: "1",
  papel: "GESTOR_PUBLICO",
  municipio: "São José dos Campos",
};
const gestorSemMunicipio: UsuarioPayload = {
  id: "2",
  papel: "GESTOR_PUBLICO",
  municipio: null,
};
const admin: UsuarioPayload = {
  id: "3",
  papel: "ADMINISTRADOR",
  municipio: null,
};

const sensor = (over: Partial<SensorComEstacao> = {}): SensorComEstacao => ({
  id: SENSOR_ID,
  tipo: "PM2.5",
  unidade_medida: "µg/m³",
  status: "Ativo",
  estacao_id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  municipio: "São José dos Campos",
  ...over,
});

const regra = (over: Partial<RegraAlerta> = {}): RegraAlerta => ({
  id: REGRA_ID,
  sensor_id: SENSOR_ID,
  nome: "PM2.5 crítico",
  operador: ">=",
  valor_limite: 50,
  severidade: "CRITICO",
  esta_ativo: true,
  criado_em: "2026-09-24T13:45:00.000Z",
  ...over,
});

const regraComSensor = (
  over: Partial<RegraAlerta & { municipio: string; sensor_status: string }> = {}
) => ({
  ...regra(),
  municipio: "São José dos Campos",
  sensor_status: "Ativo",
  ...over,
});

const payload = (
  over: Partial<CreateRegraAlertaDTO> = {}
): CreateRegraAlertaDTO => ({
  sensor_id: SENSOR_ID,
  nome: "PM2.5 crítico",
  operador: ">=",
  valor_limite: 50,
  severidade: "CRITICO",
  ...over,
});

describe("regraAlertaService.create", () => {
  it("cria a regra quando o sensor é do município do gestor", async () => {
    repo.findSensorComEstacao.mockResolvedValue(sensor());
    repo.create.mockResolvedValue(regra());

    const resultado = await regraAlertaService.create(gestor, payload());

    expect(resultado).toEqual(regra());
    expect(repo.findSensorComEstacao).toHaveBeenCalledWith(SENSOR_ID);
    expect(repo.create).toHaveBeenCalledWith({
      sensorId: SENSOR_ID,
      nome: "PM2.5 crítico",
      operador: ">=",
      valorLimite: 50,
      severidade: "CRITICO",
    });
  });

  it("retorna 404 quando o sensor não existe", async () => {
    repo.findSensorComEstacao.mockResolvedValue(null);

    await expect(
      regraAlertaService.create(gestor, payload())
    ).rejects.toMatchObject({ statusCode: 404, message: "Sensor não encontrado." });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("retorna 404 (indistinguível) quando o sensor é de outro município", async () => {
    repo.findSensorComEstacao.mockResolvedValue(
      sensor({ municipio: "Jacareí" })
    );

    await expect(
      regraAlertaService.create(gestor, payload())
    ).rejects.toMatchObject({ statusCode: 404, message: "Sensor não encontrado." });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("retorna 422 quando o sensor está inativo (RN-01)", async () => {
    repo.findSensorComEstacao.mockResolvedValue(sensor({ status: "Inativo" }));

    await expect(
      regraAlertaService.create(gestor, payload())
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("retorna 422 quando o valor limite está fora da faixa do sensor (RN-04)", async () => {
    repo.findSensorComEstacao.mockResolvedValue(sensor());

    await expect(
      regraAlertaService.create(gestor, payload({ valor_limite: -1 }))
    ).rejects.toMatchObject({
      statusCode: 422,
      message:
        "O valor limite para sensores de PM2.5 deve ser maior ou igual a 0 µg/m³.",
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("aceita o valor limite na borda da faixa (0 para PM2.5)", async () => {
    repo.findSensorComEstacao.mockResolvedValue(sensor());
    repo.create.mockResolvedValue(regra({ valor_limite: 0 }));

    await expect(
      regraAlertaService.create(gestor, payload({ valor_limite: 0 }))
    ).resolves.toMatchObject({ valor_limite: 0 });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ valorLimite: 0 })
    );
  });

  it("permite ao administrador criar em qualquer município", async () => {
    repo.findSensorComEstacao.mockResolvedValue(
      sensor({ municipio: "Jacareí" })
    );
    repo.create.mockResolvedValue(regra());

    await expect(
      regraAlertaService.create(admin, payload())
    ).resolves.toEqual(regra());
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
});

describe("regraAlertaService.list", () => {
  it("filtra pelo município do gestor", async () => {
    repo.findAllDetalhadas.mockResolvedValue([]);

    await regraAlertaService.list(gestor);

    expect(repo.findAllDetalhadas).toHaveBeenCalledWith("São José dos Campos");
  });

  it("não filtra município para o administrador", async () => {
    repo.findAllDetalhadas.mockResolvedValue([]);

    await regraAlertaService.list(admin);

    expect(repo.findAllDetalhadas).toHaveBeenCalledWith(null);
  });

  it("retorna 403 para gestor sem município, sem consultar o repository", async () => {
    await expect(
      regraAlertaService.list(gestorSemMunicipio)
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.findAllDetalhadas).not.toHaveBeenCalled();
  });
});

describe("regraAlertaService.updateStatus", () => {
  it("inativa a regra do próprio município", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(regraComSensor());
    repo.updateStatus.mockResolvedValue(regra({ esta_ativo: false }));

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Inativa")
    ).resolves.toMatchObject({ esta_ativo: false });
    expect(repo.updateStatus).toHaveBeenCalledWith(REGRA_ID, false);
  });

  it("retorna 422 ao reativar regra de sensor inativo (RN-01)", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(
      regraComSensor({ esta_ativo: false, sensor_status: "Inativo" })
    );

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Ativa")
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "Não é possível ativar regra de um sensor inativo.",
    });
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("permite inativar regra de sensor inativo", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(
      regraComSensor({ sensor_status: "Inativo" })
    );
    repo.updateStatus.mockResolvedValue(regra({ esta_ativo: false }));

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Inativa")
    ).resolves.toMatchObject({ esta_ativo: false });
    expect(repo.updateStatus).toHaveBeenCalledWith(REGRA_ID, false);
  });

  it("retorna 404 quando a regra não existe", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(null);

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Inativa")
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Regra de alerta não encontrada.",
    });
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("retorna 404 (indistinguível) quando a regra é de outro município", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(
      regraComSensor({ municipio: "Jacareí" })
    );

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Inativa")
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Regra de alerta não encontrada.",
    });
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it("retorna 404 quando o UPDATE não afeta nenhuma linha", async () => {
    repo.findByIdComMunicipio.mockResolvedValue(regraComSensor());
    repo.updateStatus.mockResolvedValue(null);

    await expect(
      regraAlertaService.updateStatus(REGRA_ID, gestor, "Inativa")
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Regra de alerta não encontrada.",
    });
  });
});
