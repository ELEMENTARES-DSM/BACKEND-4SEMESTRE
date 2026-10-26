import net from "node:net";

/**
 * Proxy TCP entre o serviço e o PostgreSQL de teste. Derrubar o proxy simula o
 * banco fora do ar (conexões cortadas e novas conexões recusadas) sem parar o
 * container; religar na mesma porta simula o banco voltando.
 */
export class ProxyTcp {
  private servidor?: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private porta = 0;

  constructor(
    private readonly destinoHost: string,
    private readonly destinoPorta: number,
  ) {}

  public async ligar(): Promise<number> {
    const servidor = net.createServer((cliente) => {
      const banco = net.connect(this.destinoPorta, this.destinoHost);
      for (const socket of [cliente, banco]) {
        this.sockets.add(socket);
        socket.on("close", () => this.sockets.delete(socket));
        socket.on("error", () => {
          cliente.destroy();
          banco.destroy();
        });
      }
      cliente.pipe(banco).pipe(cliente);
    });

    await new Promise<void>((resolve, reject) => {
      servidor.once("error", reject);
      servidor.listen(this.porta, "127.0.0.1", () => resolve());
    });
    this.porta = (servidor.address() as net.AddressInfo).port;
    this.servidor = servidor;
    return this.porta;
  }

  public async derrubar(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    const servidor = this.servidor;
    this.servidor = undefined;
    if (servidor) {
      await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
  }
}
