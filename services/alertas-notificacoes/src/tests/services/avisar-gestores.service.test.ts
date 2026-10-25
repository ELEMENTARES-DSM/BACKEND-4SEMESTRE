import { registrarAvisos } from "../../services/avisar-gestores.service";
import * as gestorRepository from "../../repositories/gestor.repository";
import * as notificacaoRepository from "../../repositories/notificacao.repository";
import { Notificacao } from "../../models/notificacao.model";
import { EventoAlarmeDisparado } from "../../validations/evento-alarme.validation";
import logger from "../../utils/logger";

jest.mock("../../repositories/gestor.repository");
jest.mock("../../repositories/notificacao.repository");

const evento = {
  alarme_id: "alarme-1",
  municipio: "São José dos Campos",
} as EventoAlarmeDisparado;

describe("registrarAvisos (US-23)", () => {
  const query = jest.fn();
  const release = jest.fn();
  const client = { query, release, on: jest.fn(), removeListener: jest.fn() };
  const dbPool = { connect: jest.fn().mockResolvedValue(client) };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    query.mockResolvedValue({ rows: [] });
    jest.mocked(notificacaoRepository.findOrCreatePendente).mockImplementation(
      async (dados) => ({ id: `aviso-${dados.destinatarioId}`, situacao: "pendente" }) as Notificacao
    );
  });

  it("registra um aviso por gestor ativo do município, na mesma transação", async () => {
    jest.mocked(gestorRepository.findGestoresAtivosDoMunicipio).mockResolvedValue([
      { id: "g-1", nome: "Ana", email: "ana@exemplo.com" },
      { id: "g-2", nome: "Bia", email: "bia@exemplo.com" },
    ]);

    const avisos = await registrarAvisos(evento, { dbPool });

    expect(gestorRepository.findGestoresAtivosDoMunicipio).toHaveBeenCalledWith("São José dos Campos", client);
    expect(notificacaoRepository.findOrCreatePendente).toHaveBeenCalledWith(
      { alarmeId: "alarme-1", destinatarioId: "g-1", canal: "email" },
      client
    );
    expect(avisos.map((a) => [a.gestor.email, a.notificacao.id])).toEqual([
      ["ana@exemplo.com", "aviso-g-1"],
      ["bia@exemplo.com", "aviso-g-2"],
    ]);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it("sem gestor ativo no município não registra aviso e deixa o motivo no log", async () => {
    jest.mocked(gestorRepository.findGestoresAtivosDoMunicipio).mockResolvedValue([]);

    expect(await registrarAvisos(evento, { dbPool })).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      "Alarme sem gestor ativo no município; nenhum aviso registrado",
      { alarme_id: "alarme-1", municipio: "São José dos Campos" }
    );
  });

  it("falha no meio desfaz a transação e devolve o erro", async () => {
    jest.mocked(gestorRepository.findGestoresAtivosDoMunicipio).mockResolvedValue([{ id: "g-1", nome: "Ana", email: "a@b" }]);
    jest.mocked(notificacaoRepository.findOrCreatePendente).mockRejectedValue(new Error("falhou"));

    await expect(registrarAvisos(evento, { dbPool })).rejects.toThrow("falhou");
    expect(query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalled();
  });
});
