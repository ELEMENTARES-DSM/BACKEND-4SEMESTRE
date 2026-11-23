import { conectarValkey, desconectarValkey, getValkeyClient } from "../../config/valkey";
import { COTAS_POR_PERFIL, obterAnoMes, obterAnoSemanaIso } from "../../config/cotas";
import { verificarEDebitarCota } from "../../services/cota.service";

const integration = describe;
type ClienteBruto = { get(c: string): Promise<string | null>; set(c: string, v: string): Promise<unknown>; del(c: string): Promise<unknown> };

integration("cota.valkey (US-42)", () => {
  const usuarioId = `int-${Date.now()}`;
  const chaveSemana = () => `cota:${usuarioId}:semana:${obterAnoSemanaIso()}`;
  const chaveMes = () => `cota:${usuarioId}:mes:${obterAnoMes()}`;
  const cliente = () => getValkeyClient() as unknown as ClienteBruto;

  beforeAll(async () => { await conectarValkey(); });
  afterAll(async () => {
    await cliente().del(chaveSemana());
    await cliente().del(chaveMes());
    await desconectarValkey();
  });

  it("deve gravar o contador de semana e de mês no Valkey quando há um pedido", async () => {
    // Dado: usuário MUNICIPE sem uso. Quando: faz um pedido. Então: contador gravado
    const res = await verificarEDebitarCota(usuarioId, "MUNICIPE");
    expect(res.semanaRestante).toBe(COTAS_POR_PERFIL.MUNICIPE!.semanal - 1);
    expect(await cliente().get(chaveSemana())).toBe("1");
    expect(await cliente().get(chaveMes())).toBe("1");
  });

  it("deve manter o contador após reconectar quando já houve pedido", async () => {
    // Dado: um pedido já feito. Quando: reconecta e faz outro. Então: continua de onde parou
    await desconectarValkey();
    await conectarValkey();
    const res = await verificarEDebitarCota(usuarioId, "MUNICIPE");
    expect(res.semanaRestante).toBe(COTAS_POR_PERFIL.MUNICIPE!.semanal - 2);
  });

  it("deve recusar pela semana quando a chave gravada no Valkey já está no limite", async () => {
    // Dado: chave da semana no limite. Quando: pedido. Então: bloqueado pela semana
    await cliente().set(chaveSemana(), String(COTAS_POR_PERFIL.MUNICIPE!.semanal));
    const res = await verificarEDebitarCota(usuarioId, "MUNICIPE");
    expect(res.permitido).toBe(false);
    expect(res.motivo).toBe("semana");
  });
});
