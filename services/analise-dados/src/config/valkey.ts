export interface ValkeyClientInterface {
  isOpen: boolean;
  connect(): Promise<void>;
  quit(): Promise<void>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean | number>;
  on(event: string, listener: (err: Error) => void): void;
}

let clientInstance: ValkeyClientInterface | null = null;

export function getValkeyClient(): ValkeyClientInterface {
  if (!clientInstance) {
    try {
      // Tenta carregar o driver redis se estiver instalado
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const redis = require("redis");
      const url = process.env.REDIS_URL || process.env.VALKEY_URL || "redis://localhost:6379";
      const nativeClient = redis.createClient({ url, disableOfflineQueue: true });
      nativeClient.on("error", (err: Error) => {
        console.warn("[Valkey] Aviso de conexão:", err?.message || err);
      });
      clientInstance = nativeClient as ValkeyClientInterface;
    } catch {
      // Driver ainda não instalado: provê fallback seguro em memória
      const memory = new Map<string, number>();
      clientInstance = {
        isOpen: false,
        async connect() {
          this.isOpen = true;
        },
        async quit() {
          this.isOpen = false;
        },
        async incr(key: string) {
          const val = (memory.get(key) || 0) + 1;
          memory.set(key, val);
          return val;
        },
        async decr(key: string) {
          const val = Math.max(0, (memory.get(key) || 0) - 1);
          memory.set(key, val);
          return val;
        },
        async expire() {
          return 1;
        },
        on() {},
      };
    }
  }
  return clientInstance;
}

export async function conectarValkey(): Promise<void> {
  const c = getValkeyClient();
  if (!c.isOpen) {
    try {
      await c.connect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Valkey] Não foi possível conectar ao Valkey:", msg);
    }
  }
}

export async function desconectarValkey(): Promise<void> {
  if (clientInstance && clientInstance.isOpen) {
    await clientInstance.quit();
    clientInstance = null;
  }
}
