import { TIPOS_DEFEITO, type TipoDefeito } from "./defeitos.js";

export class Contadores {
  private totalEnviado = 0;
  private validas = 0;
  private readonly porTipo = new Map<TipoDefeito, number>(
    TIPOS_DEFEITO.map((tipo) => [tipo, 0]),
  );

  // publicadas = quantas vezes a mensagem saiu (duplicata conta 2).
  registrar(defeito: TipoDefeito | null, publicadas: number): void {
    this.totalEnviado += publicadas;

    if (defeito) {
      this.porTipo.set(defeito, (this.porTipo.get(defeito) ?? 0) + 1);
    } else {
      this.validas += publicadas;
    }
  }

  resumo(): string {
    const tipos = [...this.porTipo]
      .filter(([, quantidade]) => quantidade > 0)
      .map(([tipo, quantidade]) => `${tipo}=${quantidade}`)
      .join(", ");

    return (
      `[simulador] Totais: enviadas=${this.totalEnviado}, ` +
      `válidas=${this.validas}, com defeito: ${tipos || "nenhuma"}`
    );
  }
}
