import { createClient } from "redis";

export type ClienteValkey = ReturnType<typeof createClient>;

let cliente: ClienteValkey | undefined;
let conectando: Promise<ClienteValkey> | undefined;

// Quanto esperar e quantas vezes tentar ao conectar: com o Valkey fora, o pedido
// falha em poucos segundos em vez de ficar preso.
const TEMPO_DE_CONEXAO_MS = 2000;
const TENTATIVAS_DE_RECONEXAO = 2;

async function abrir(): Promise<ClienteValkey> {
  if (cliente) {
    // Cliente que caiu: descarta e abre outro.
    await cliente.disconnect().catch(() => undefined);
    cliente = undefined;
  }

  const novo: ClienteValkey = createClient({
    url: process.env.REDIS_URL,
    // Sem fila offline: comando com o Valkey fora falha na hora.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: TEMPO_DE_CONEXAO_MS,
      reconnectStrategy: (tentativas) =>
        tentativas < TENTATIVAS_DE_RECONEXAO
          ? 200
          : new Error("Valkey indisponível"),
    },
  });
  novo.on("error", (erro: Error) => {
    console.error("Erro no cliente Valkey", erro.message);
  });

  await novo.connect();
  cliente = novo;
  return novo;
}

/**
 * Cliente do Valkey já conectado (REDIS_URL), aberto no primeiro uso e reaberto
 * se a conexão cair. Este serviço só LÊ o staging da ingestão-dados
 * (staging:msg:*) para listar os códigos de sensor que as estações já enviaram:
 * nada é gravado lá. Com o Valkey fora a Promise rejeita e a tela mostra o aviso.
 */
export async function valkey(): Promise<ClienteValkey> {
  if (cliente?.isReady) return cliente;

  // Pedidos juntos esperam a mesma conexão.
  conectando ??= abrir().finally(() => {
    conectando = undefined;
  });
  return conectando;
}
