export const ESCALA_6 = 1_000_000n;
const DIVISOR_ESCALA_12_PARA_2 = 10_000_000_000n;
const METADE_DIVISOR_ESCALA_12_PARA_2 = 5_000_000_000n;

function expandirNotacaoCientifica(texto: string): string {
  if (!/[eE]/.test(texto)) {
    return texto;
  }

  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(texto);
  if (!match) {
    throw new Error(`Valor decimal inválido: ${texto}`);
  }

  const [, sinal, intPart, fracPart = "", expStr] = match;
  const exp = Number.parseInt(expStr, 10);
  const digitos = intPart + fracPart;
  const posicaoPonto = intPart.length + exp;

  if (posicaoPonto <= 0) {
    return `${sinal}0.${"0".repeat(-posicaoPonto)}${digitos}`;
  }

  if (posicaoPonto >= digitos.length) {
    return `${sinal}${digitos}${"0".repeat(posicaoPonto - digitos.length)}`;
  }

  return `${sinal}${digitos.slice(0, posicaoPonto)}.${digitos.slice(posicaoPonto)}`;
}

/**
 * Converte um número ou string decimal para BigInt na escala 10^6,
 * aplicando arredondamento HALF_UP caso a entrada possua mais de 6 casas decimais.
 */
export function paraBigIntEscala6(entrada: number | string): bigint {
  if (typeof entrada === "number") {
    if (!Number.isFinite(entrada)) {
      throw new Error(`Valor numérico inválido: ${String(entrada)}`);
    }
  }

  const textoBruto = String(entrada).trim();
  if (textoBruto.length === 0) {
    throw new Error("Valor decimal vazio");
  }

  const texto = expandirNotacaoCientifica(textoBruto);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!match) {
    throw new Error(`Valor decimal inválido: ${textoBruto}`);
  }

  const [, sinalStr, parteInteiraStr, parteFracionariaStr = ""] = match;
  const negativo = sinalStr === "-";

  const parteInteira = BigInt(parteInteiraStr) * ESCALA_6;
  const primeiros6 = parteFracionariaStr.slice(0, 6).padEnd(6, "0");
  let absoluto = parteInteira + BigInt(primeiros6);

  if (parteFracionariaStr.length > 6) {
    const setimoDigito = Number.parseInt(parteFracionariaStr[6], 10);
    if (setimoDigito >= 5) {
      absoluto += 1n;
    }
  }

  if (absoluto === 0n) {
    return 0n;
  }

  return negativo ? -absoluto : absoluto;
}

/**
 * Formata um BigInt em escala 2 (centésimos) como string com 2 casas decimais.
 */
export function formatarEscala2(centavos: bigint): string {
  if (centavos === 0n) {
    return "0.00";
  }

  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const inteiro = abs / 100n;
  const fracao = (abs % 100n).toString().padStart(2, "0");

  return `${negativo ? "-" : ""}${inteiro.toString()}.${fracao}`;
}

/**
 * Formata um BigInt em escala 6 como string com 6 casas decimais.
 */
export function formatarEscala6(valorEscala6: bigint): string {
  if (valorEscala6 === 0n) {
    return "0.000000";
  }

  const negativo = valorEscala6 < 0n;
  const abs = negativo ? -valorEscala6 : valorEscala6;
  const inteiro = abs / ESCALA_6;
  const fracao = (abs % ESCALA_6).toString().padStart(6, "0");

  return `${negativo ? "-" : ""}${inteiro.toString()}.${fracao}`;
}

/**
 * Calcula valor_real = (bruto * fator) + ganho usando BigInt em escala 6,
 * retornando o resultado com 2 casas decimais e arredondamento HALF_UP
 * (afastando-se de zero em caso de empate).
 */
export function calibrarValor(
  valorBruto: number | string,
  fator: number | string,
  ganho: number | string,
): string {
  const bruto6 = paraBigIntEscala6(valorBruto);
  const fator6 = paraBigIntEscala6(fator);
  const ganho6 = paraBigIntEscala6(ganho);

  // (bruto6 * fator6) está na escala 10^12; ganho6 * 10^6 também está na escala 10^12
  const totalEscala12 = bruto6 * fator6 + ganho6 * ESCALA_6;

  if (totalEscala12 === 0n) {
    return "0.00";
  }

  const negativo = totalEscala12 < 0n;
  const absTotal = negativo ? -totalEscala12 : totalEscala12;
  const absCentavos =
    (absTotal + METADE_DIVISOR_ESCALA_12_PARA_2) / DIVISOR_ESCALA_12_PARA_2;
  const centavos = negativo ? -absCentavos : absCentavos;

  return formatarEscala2(centavos);
}

/**
 * Compara dois valores brutos em escala 6 (ex.: valor vindo do JSON vs NUMERIC(18,6) do banco).
 */
export function valoresBrutosIguais(
  a: number | string,
  b: number | string,
): boolean {
  return paraBigIntEscala6(a) === paraBigIntEscala6(b);
}
