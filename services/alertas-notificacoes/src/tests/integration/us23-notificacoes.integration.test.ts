import { randomUUID } from "node:crypto";
import { pool } from "../../config/db";
import { findGestoresAtivosDoMunicipio } from "../../repositories/gestor.repository";
import {
  findByAlarme,
  findOrCreatePendente,
  registrarEnvio,
  registrarFalha,
} from "../../repositories/notificacao.repository";
import { cadastrarUsuario, prepararSchemaNotificacoes } from "./helpers/banco-notificacoes";

// US-23 (TASK 23.01) com PostgreSQL real. Execute com ALERTAS_TEST_DATABASE_URL
// apontando para uma instância de teste.
const databaseUrl = process.env.ALERTAS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("US-23 - notificacoes e gestores ativos (PostgreSQL)", () => {
  const schema = `alertas_us23_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    await prepararSchemaNotificacoes(pool, schema);
  });

  afterAll(async () => {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE notificacoes, usuarios");
  });

  it("só os gestores ativos do município da estação recebem aviso", async () => {
    const ana = await cadastrarUsuario(pool, { nome: "Ana Gestora", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" });
    const bia = await cadastrarUsuario(pool, { nome: "Bia Gestora", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos" });
    await cadastrarUsuario(pool, { nome: "Caio Inativo", papel: "GESTOR_PUBLICO", municipio: "São José dos Campos", ativo: false });
    await cadastrarUsuario(pool, { nome: "Davi Paulista", papel: "GESTOR_PUBLICO", municipio: "São Paulo" });
    await cadastrarUsuario(pool, { nome: "Eva Admin", papel: "ADMINISTRADOR" });
    await cadastrarUsuario(pool, { nome: "Fabio Pesquisador", papel: "PESQUISADOR", municipio: "São José dos Campos" });

    const gestores = await findGestoresAtivosDoMunicipio("São José dos Campos");

    expect(gestores).toEqual([
      { id: ana, nome: "Ana Gestora", email: "ana.gestora@exemplo.com" },
      { id: bia, nome: "Bia Gestora", email: "bia.gestora@exemplo.com" },
    ]);
  });

  it("o mesmo alarme, destinatário e canal não grava dois avisos", async () => {
    const alarme = randomUUID();
    const gestor = randomUUID();

    const primeiro = await findOrCreatePendente({ alarmeId: alarme, destinatarioId: gestor, canal: "email" });
    const segundo = await findOrCreatePendente({ alarmeId: alarme, destinatarioId: gestor, canal: "email" });

    expect(segundo.id).toBe(primeiro.id);
    expect(primeiro).toEqual(expect.objectContaining({ situacao: "pendente", tentativas: 0, ultimo_erro: null, enviado_em: null }));
    expect(await findByAlarme(alarme)).toHaveLength(1);
  });

  it("uma falha e depois o envio deixam 2 tentativas e situação enviado", async () => {
    const aviso = await findOrCreatePendente({ alarmeId: randomUUID(), destinatarioId: randomUUID(), canal: "email" });

    const falhou = await registrarFalha(aviso.id, "SMTP indisponível", false);
    const enviado = await registrarEnvio(aviso.id, new Date("2026-10-24T13:00:05.000Z"));

    expect(falhou).toEqual(expect.objectContaining({ situacao: "pendente", tentativas: 1, ultimo_erro: "SMTP indisponível" }));
    expect(enviado).toEqual(expect.objectContaining({ situacao: "enviado", tentativas: 2 }));
    expect(enviado?.enviado_em?.toISOString()).toBe("2026-10-24T13:00:05.000Z");
  });

  it("três falhas deixam o aviso como falhou, e aviso enviado não é alterado de novo", async () => {
    const aviso = await findOrCreatePendente({ alarmeId: randomUUID(), destinatarioId: randomUUID(), canal: "email" });

    await registrarFalha(aviso.id, "erro 1", false);
    await registrarFalha(aviso.id, "erro 2", false);
    const terceira = await registrarFalha(aviso.id, "erro 3", true);

    expect(terceira).toEqual(expect.objectContaining({ situacao: "falhou", tentativas: 3, ultimo_erro: "erro 3" }));

    const outro = await findOrCreatePendente({ alarmeId: randomUUID(), destinatarioId: randomUUID(), canal: "email" });
    await registrarEnvio(outro.id, new Date());
    expect(await registrarEnvio(outro.id, new Date())).toBeNull();
    expect(await registrarFalha(outro.id, "tarde demais", true)).toBeNull();
  });

  it("o banco recusa canal desconhecido e enviado sem horário", async () => {
    await expect(
      pool.query(`INSERT INTO notificacoes (alarme_id, destinatario_id, canal) VALUES ($1, $2, 'sms')`, [randomUUID(), randomUUID()])
    ).rejects.toThrow(/chk_notificacoes_canal/);
    await expect(
      pool.query(
        `INSERT INTO notificacoes (alarme_id, destinatario_id, canal, situacao) VALUES ($1, $2, 'email', 'enviado')`,
        [randomUUID(), randomUUID()]
      )
    ).rejects.toThrow(/chk_notificacoes_enviado_em/);
  });

  it("a migration desce removendo só a tabela notificacoes", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration = require("../../db/migrations/1800000000001_create-notificacoes-table.cjs");
    const comandos: string[] = [];
    migration.down({ sql: (sql: string) => comandos.push(sql) });

    expect(comandos).toEqual(["DROP TABLE IF EXISTS notificacoes;"]);
  });
});
