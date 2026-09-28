import { redisClient } from "../config/redis";

export const tokenEstaRevogado = async (jti: string): Promise<boolean> => {
    const valor = await redisClient.get(`token-revogado:${jti}`);
    return valor !== null;
};