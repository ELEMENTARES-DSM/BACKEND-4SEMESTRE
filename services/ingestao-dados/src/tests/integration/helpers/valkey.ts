import { valkey } from "../../../config/valkey";
import { MensagemBruta } from "../../../dto/mensagem-ingestao.dto";
import { gravarBruta, lerMensagem } from "../../../repositories/staging-valkey.repository";
import { ResultadoVerificacao, verificarMensagem } from "../../../services/processar-mensagem.service";

/**
 * Aponta o cliente do serviço para o Valkey de teste (VALKEY_TEST_URL), num
 * banco lógico só deste arquivo: o jest roda os arquivos em paralelo e as
 * listas staging:* são globais no banco. Chamar antes do primeiro uso.
 */
export async function usarValkeyDeTeste(banco: number, url = process.env.VALKEY_TEST_URL as string): Promise<void> {
  const destino = new URL(url);
  destino.pathname = `/${banco}`;
  process.env.REDIS_URL = destino.toString();
  await esperarValkeyPronto();
  await valkey().flushDb();
}

export async function esperarValkeyPronto(): Promise<void> {
  const cliente = valkey();
  if (!cliente.isReady) await new Promise((resolve) => cliente.once("ready", resolve));
}

/** Grava a mensagem bruta no Valkey e roda a verificação lendo de lá, como o serviço faz. */
export async function gravarEVerificar(mensagem: MensagemBruta): Promise<ResultadoVerificacao> {
  const id = await gravarBruta(mensagem);
  const staging = await lerMensagem(id);
  return verificarMensagem(staging!);
}

export async function esperar(condicao: () => Promise<boolean>, limiteMs = 15000): Promise<void> {
  const inicio = Date.now();
  while (!(await condicao())) {
    if (Date.now() - inicio > limiteMs) throw new Error("tempo esgotado esperando a condição");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
