import {
  findOrCreatePendente,
  registrarEnvio,
  registrarFalha,
} from "../../repositories/notificacao.repository";
import { findGestoresAtivosDoMunicipio } from "../../repositories/gestor.repository";

describe("notificacao.repository (US-23)", () => {
  const aviso = {
    id: "aviso-1",
    alarme_id: "alarme-1",
    destinatario_id: "gestor-1",
    canal: "email",
    situacao: "pendente",
    tentativas: 0,
  };

  it("cria o aviso pendente com ON CONFLICT na chave alarme, destinatário e canal", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [aviso] });

    const criado = await findOrCreatePendente(
      { alarmeId: "alarme-1", destinatarioId: "gestor-1", canal: "email" },
      { query }
    );

    expect(criado).toEqual(aviso);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (alarme_id, destinatario_id, canal) DO NOTHING");
    expect(query.mock.calls[0][1]).toEqual(["alarme-1", "gestor-1", "email"]);
  });

  it("devolve o aviso que já existia quando o mesmo evento chega de novo", async () => {
    const existente = { ...aviso, situacao: "enviado", tentativas: 1 };
    const query = jest.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [existente] });

    const encontrado = await findOrCreatePendente(
      { alarmeId: "alarme-1", destinatarioId: "gestor-1", canal: "email" },
      { query }
    );

    expect(encontrado).toEqual(existente);
    expect(query.mock.calls[1][0]).toContain("SELECT * FROM notificacoes");
  });

  it("o envio conta a tentativa e não mexe em aviso já enviado", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const enviadoEm = new Date("2026-10-24T13:00:05.000Z");

    expect(await registrarEnvio("aviso-1", enviadoEm, { query })).toBeNull();
    expect(query.mock.calls[0][0]).toContain("tentativas = tentativas + 1");
    expect(query.mock.calls[0][0]).toContain("situacao <> 'enviado'");
    expect(query.mock.calls[0][1]).toEqual(["aviso-1", enviadoEm]);
  });

  it("a falha guarda o erro e só vira falhou quando esgota as tentativas", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ ...aviso, tentativas: 1 }] });

    await registrarFalha("aviso-1", "SMTP indisponível", false, { query });
    await registrarFalha("aviso-1", "SMTP indisponível", true, { query });

    expect(query.mock.calls[0][0]).toContain("CASE WHEN $3::boolean THEN 'falhou' ELSE 'pendente' END");
    expect(query.mock.calls.map((c) => c[1])).toEqual([
      ["aviso-1", "SMTP indisponível", false],
      ["aviso-1", "SMTP indisponível", true],
    ]);
  });
});

describe("gestor.repository (US-23)", () => {
  it("lê só gestores públicos ativos do município, sem escrever em usuarios", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ id: "g-1", nome: "Ana", email: "ana@exemplo.com" }] });

    const gestores = await findGestoresAtivosDoMunicipio("São José dos Campos", { query });

    expect(gestores).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("p.nome = 'GESTOR_PUBLICO'");
    expect(sql).toContain("u.esta_ativo");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
    expect(params).toEqual(["São José dos Campos"]);
  });
});
