import { redisClient } from "../config/redis";

const PREFIXO = "token-revogado:";

// TTL = tempo restante até o token expirar naturalmente.
// Depois disso o Redis apaga a chave sozinho — não acumula lixo.
export const revogarToken = async (jti: string, exp: number): Promise<void> => {
  const ttlSegundos = exp - Math.floor(Date.now() / 1000);

  if (ttlSegundos <= 0) {
    return; // token já expirado, nada a fazer
  }

  await redisClient.set(`${PREFIXO}${jti}`, "1", { EX: ttlSegundos });
};

export const tokenEstaRevogado = async (jti: string): Promise<boolean> => {
  const valor = await redisClient.get(`${PREFIXO}${jti}`);
  return valor !== null;
};