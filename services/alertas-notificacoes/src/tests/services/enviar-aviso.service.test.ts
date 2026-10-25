import {
  ESPERA_ENTRE_TENTATIVAS_MS,
  MAXIMO_TENTATIVAS,
  enviarAvisos,
  montarEmail,
} from "../../services/enviar-aviso.service";
import * as notificacaoRepository from "../../repositories/notificacao.repository";
import { AvisoRegistrado } from "../../services/avisar-gestores.service";
import { Alarme } from "../../models/alarme.model";
import { Notificacao } from "../../models/notificacao.model";
import { EventoAlarmeDisparado } from "../../validations/evento-alarme.validation";
import nodemailer from "nodemailer";
import { criarTransporte, lerConfigEmail, REMETENTE_PADRAO, TEMPOS_LIMITE_SMTP_MS } from "../../config/email";
import logger from "../../utils/logger";

jest.mock("../../repositories/notificacao.repository");

const evento: EventoAlarmeDisparado = {
  alarme_id: "0b6f2a4e-1c3d-4e5f-8a9b-1c2d3e4f5a6b",
  regra_id: "7b1e2c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  medida_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  sensor_id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  estacao_id: "9c8b7a6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  municipio: "São José dos Campos",
  valor: "52.300000",
  operador: ">=",
  limite: "50.00",
  severidade: "CRITICO",
  lido_em: "2026-10-24T13:00:00.000Z",
  criado_em: "2026-10-24T13:00:01.412Z",
};

const alarme = {
  estacao_codigo: "SJC-001",
  estacao_nome: "Estação Centro",
  sensor_codigo: "PM25-01",
  sensor_tipo: "PM2.5",
  sensor_unidade_medida: "µg/m³",
  regra_nome: "PM2.5 crítico",
} as Alarme;

const aviso = (id: string, tentativas = 0, situacao: Notificacao["situacao"] = "pendente"): AvisoRegistrado => ({
  notificacao: { id, situacao, tentativas } as Notificacao,
  gestor: { id: `gestor-${id}`, nome: `Gestor ${id}`, email: `${id}@exemplo.com` },
});

describe("enviarAvisos (US-23)", () => {
  const agora = new Date("2026-10-24T13:00:05.000Z");
  let esperas: number[];
  const opcoes = (enviarEmail: jest.Mock) => ({
    enviarEmail,
    esperar: async (ms: number) => {
      esperas.push(ms);
    },
    agora: () => agora,
    buscarAlarme: async () => alarme,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    esperas = [];
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
  });

  it("cenário 1: cada gestor recebe o e-mail e o envio fica registrado na primeira tentativa", async () => {
    const enviar = jest.fn().mockResolvedValue(undefined);

    const resultado = await enviarAvisos(evento, [aviso("a"), aviso("b")], opcoes(enviar));

    expect(resultado).toEqual({ enviados: 2, falharam: 0 });
    expect(enviar.mock.calls.map(([m]) => m.para)).toEqual(["a@exemplo.com", "b@exemplo.com"]);
    expect(notificacaoRepository.registrarEnvio).toHaveBeenCalledWith("a", agora);
    expect(notificacaoRepository.registrarFalha).not.toHaveBeenCalled();
  });

  it("cenário 6: falha uma vez e depois funciona; a segunda tentativa espera antes", async () => {
    const enviar = jest.fn().mockRejectedValueOnce(new Error("SMTP ocupado")).mockResolvedValue(undefined);

    const resultado = await enviarAvisos(evento, [aviso("a")], opcoes(enviar));

    expect(resultado).toEqual({ enviados: 1, falharam: 0 });
    expect(notificacaoRepository.registrarFalha).toHaveBeenCalledWith("a", "SMTP ocupado", false);
    expect(notificacaoRepository.registrarEnvio).toHaveBeenCalledTimes(1);
    expect(esperas).toEqual([ESPERA_ENTRE_TENTATIVAS_MS]);
  });

  it("cenário 4: três falhas marcam o aviso como falhou e o resultado pede a DLQ", async () => {
    const enviar = jest.fn().mockRejectedValue(new Error("SMTP fora do ar"));

    const resultado = await enviarAvisos(evento, [aviso("a"), aviso("b")], opcoes(enviar));

    expect(resultado).toEqual({ enviados: 0, falharam: 2 });
    expect(enviar).toHaveBeenCalledTimes(2 * MAXIMO_TENTATIVAS);
    expect(jest.mocked(notificacaoRepository.registrarFalha).mock.calls.filter(([id]) => id === "a")).toEqual([
      ["a", "SMTP fora do ar", false],
      ["a", "SMTP fora do ar", false],
      ["a", "SMTP fora do ar", true],
    ]);
    expect(notificacaoRepository.registrarEnvio).not.toHaveBeenCalled();
  });

  it("evento entregue de novo continua das tentativas que faltam e não reenvia o que já foi enviado", async () => {
    const enviar = jest.fn().mockRejectedValue(new Error("x"));

    const resultado = await enviarAvisos(
      evento,
      [aviso("enviado", 1, "enviado"), aviso("parcial", 2), aviso("esgotado", 3, "falhou")],
      opcoes(enviar)
    );

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0].para).toBe("parcial@exemplo.com");
    expect(resultado).toEqual({ enviados: 0, falharam: 2 });
  });

  it("cenário 5: tudo já enviado não consulta o alarme nem envia", async () => {
    const enviar = jest.fn();
    const buscarAlarme = jest.fn();

    const resultado = await enviarAvisos(evento, [aviso("a", 1, "enviado")], { ...opcoes(enviar), buscarAlarme });

    expect(resultado).toEqual({ enviados: 0, falharam: 0 });
    expect(enviar).not.toHaveBeenCalled();
    expect(buscarAlarme).not.toHaveBeenCalled();
  });

  it("cenário 7: o e-mail cita a severidade, a estação, o sensor, o valor, o limite e o horário de Brasília", () => {
    const email = montarEmail(evento, alarme, aviso("a").gestor);

    expect(email.assunto).toBe("[Pulso Urbano] Alarme Crítico na estação SJC-001 · Estação Centro (São José dos Campos)");
    expect(email.texto).toContain("Sensor: PM25-01 · PM2.5");
    expect(email.texto).toContain("Regra: PM2.5 crítico");
    expect(email.texto).toContain("Valor medido: 52,30 µg/m³ (limite >= 50,00 µg/m³)");
    expect(email.texto).toContain("Horário da leitura: 24/10/2026, 10:00:00");
  });

  it("sem os nomes do alarme o e-mail sai com os identificadores", () => {
    const email = montarEmail(evento, null, aviso("a").gestor);

    expect(email.assunto).toContain(evento.estacao_id);
    expect(email.texto).toContain(`Regra: ${evento.regra_id}`);
  });
});

describe("lerConfigEmail (US-23)", () => {
  it("lê o canal só das variáveis de ambiente", () => {
    expect(
      lerConfigEmail({ SMTP_HOST: "mailpit", SMTP_PORT: "1025", SMTP_USER: "u", SMTP_PASSWORD: "s", SMTP_FROM: "a@b" })
    ).toEqual({ host: "mailpit", port: 1025, secure: false, usuario: "u", senha: "s", remetente: "a@b" });
  });

  it("sem SMTP_HOST não há canal; o resto tem padrão", () => {
    expect(lerConfigEmail({})).toBeNull();
    expect(lerConfigEmail({ SMTP_HOST: "smtp", SMTP_SECURE: "true" })).toEqual({
      host: "smtp",
      port: 587,
      secure: true,
      usuario: undefined,
      senha: undefined,
      remetente: REMETENTE_PADRAO,
    });
  });

  it("o transporte tem tempo limite próprio: SMTP que não responde falha a tentativa em segundos", () => {
    const createTransport = jest.spyOn(nodemailer, "createTransport");

    criarTransporte({ host: "smtp", port: 587, secure: false, remetente: REMETENTE_PADRAO });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: TEMPOS_LIMITE_SMTP_MS.conexao,
        greetingTimeout: TEMPOS_LIMITE_SMTP_MS.saudacao,
        socketTimeout: TEMPOS_LIMITE_SMTP_MS.resposta,
      })
    );
    expect(TEMPOS_LIMITE_SMTP_MS.conexao + TEMPOS_LIMITE_SMTP_MS.resposta).toBeLessThanOrEqual(60_000);
    createTransport.mockRestore();
  });
});
