export interface LogEntry {
  nivel: string;
  mensagem: string;
  timestamp: string;
  contexto?: unknown;
}

export class Logger {
  public info(mensagem: string, contexto?: unknown): void {
    console.info(this.formatar("info", mensagem, contexto));
  }

  public warn(mensagem: string, contexto?: unknown): void {
    console.warn(this.formatar("warn", mensagem, contexto));
  }

  public error(mensagem: string, contexto?: unknown): void {
    console.error(this.formatar("error", mensagem, contexto));
  }

  private formatar(nivel: string, mensagem: string, contexto?: unknown): string {
    const registro: LogEntry = {
      nivel,
      mensagem,
      timestamp: new Date().toISOString(),
    };

    if (contexto !== undefined) {
      registro.contexto = contexto;
    }

    return JSON.stringify(registro);
  }
}

export const logger = new Logger();
export default logger;
