import { createClient } from "redis";
import { logger } from "../utils/logger";

export type ClienteValkey = ReturnType<typeof createClient>;

let cliente: ClienteValkey | undefined;

/**
 * Cliente do Valkey, o staging das leituras MQTT (US-40), criado na primeira
 * chamada com a REDIS_URL. Com disableOfflineQueue, um comando com o Valkey
 * fora falha na hora em vez de esperar numa fila em memória: a mensagem não é
 * confirmada ao broker e volta pela sessão persistente.
 */
export function valkey(): ClienteValkey {
  if (!cliente) {
    const novo: ClienteValkey = createClient({
      url: process.env.REDIS_URL,
      disableOfflineQueue: true,
      socket: { reconnectStrategy: () => 1000 },
    });
    novo.on("error", (erro: Error) => {
      logger.error("Erro no cliente Valkey", { erro: erro.message });
    });
    // A reconexão é do próprio cliente (reconnectStrategy), inclusive na primeira.
    void novo.connect().catch(() => undefined);
    cliente = novo;
  }
  return cliente;
}

export async function encerrarValkey(): Promise<void> {
  const atual = cliente;
  cliente = undefined;
  if (atual?.isOpen) await atual.disconnect().catch(() => undefined);
}
