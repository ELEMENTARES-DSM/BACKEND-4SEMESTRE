import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

// US-23: credenciais do canal de e-mail só em variável de ambiente, nunca no código.
export interface ConfigEmail {
  host: string;
  port: number;
  secure: boolean;
  usuario?: string;
  senha?: string;
  remetente: string;
}

export const REMETENTE_PADRAO = "Pulso Urbano <alertas@pulsourbano.local>";

// Os padrões do nodemailer (2 min para conectar, 10 min sem resposta) prenderiam o
// evento por até meia hora em três tentativas e passariam do prazo de ack do RabbitMQ.
export const TEMPOS_LIMITE_SMTP_MS = { conexao: 10_000, saudacao: 10_000, resposta: 30_000 };

/** null quando SMTP_HOST não está definido: o aviso falha e conta como tentativa. */
export function lerConfigEmail(env: NodeJS.ProcessEnv = process.env): ConfigEmail | null {
  if (!env.SMTP_HOST) {
    return null;
  }

  return {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === "true",
    usuario: env.SMTP_USER || undefined,
    senha: env.SMTP_PASSWORD || undefined,
    remetente: env.SMTP_FROM || REMETENTE_PADRAO,
  };
}

export function criarTransporte(config: ConfigEmail): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.usuario ? { user: config.usuario, pass: config.senha } : undefined,
    connectionTimeout: TEMPOS_LIMITE_SMTP_MS.conexao,
    greetingTimeout: TEMPOS_LIMITE_SMTP_MS.saudacao,
    socketTimeout: TEMPOS_LIMITE_SMTP_MS.resposta,
  });
}
