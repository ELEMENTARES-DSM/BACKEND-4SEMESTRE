import type { Transporter } from "nodemailer";
import { criarTransporte, lerConfigEmail } from "../config/email";
import { Alarme } from "../models/alarme.model";
import { GestorAtivo } from "../models/notificacao.model";
import { findById as findAlarmeById } from "../repositories/alarme.repository";
import { registrarEnvio, registrarFalha } from "../repositories/notificacao.repository";
import { EventoAlarmeDisparado } from "../validations/evento-alarme.validation";
import logger from "../utils/logger";
import { AvisoRegistrado } from "./avisar-gestores.service";

// US-23: até 3 tentativas por destinatário; depois disso o evento vai para a DLQ.
export const MAXIMO_TENTATIVAS = 3;
export const ESPERA_ENTRE_TENTATIVAS_MS = 2000;

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
}

export type EnviarEmail = (mensagem: MensagemEmail) => Promise<void>;

export interface OpcoesEnvio {
  enviarEmail?: EnviarEmail;
  esperar?: (ms: number) => Promise<void>;
  agora?: () => Date;
  buscarAlarme?: (id: string) => Promise<Alarme | null>;
}

export interface ResultadoEnvio {
  enviados: number;
  falharam: number;
}

const SEVERIDADES = { CRITICO: "Crítico", ALERTA: "Alerta", ATENCAO: "Atenção" } as const;

let transporte: Transporter | undefined;

const enviarPorSmtp: EnviarEmail = async (mensagem) => {
  const config = lerConfigEmail();
  if (!config) {
    throw new Error("Canal de e-mail sem configuração (SMTP_HOST)");
  }
  transporte ??= criarTransporte(config);
  await transporte.sendMail({
    from: config.remetente,
    to: mensagem.para,
    subject: mensagem.assunto,
    text: mensagem.texto,
  });
};

const numero = (valor: string) =>
  Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const horario = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(iso));

/** Texto do aviso com os nomes da estação, do sensor e da regra, quando disponíveis. */
export function montarEmail(
  evento: EventoAlarmeDisparado,
  alarme: Alarme | null,
  gestor: GestorAtivo
): MensagemEmail {
  const estacao = alarme?.estacao_codigo
    ? `${alarme.estacao_codigo} · ${alarme.estacao_nome ?? ""}`.trim()
    : evento.estacao_id;
  const sensor = alarme?.sensor_codigo
    ? `${alarme.sensor_codigo} · ${alarme.sensor_tipo ?? ""}`.trim()
    : evento.sensor_id;
  const unidade = alarme?.sensor_unidade_medida ? ` ${alarme.sensor_unidade_medida}` : "";
  const severidade = SEVERIDADES[evento.severidade];

  return {
    para: gestor.email,
    assunto: `[Pulso Urbano] Alarme ${severidade} na estação ${estacao} (${evento.municipio})`,
    texto: [
      `Olá, ${gestor.nome}.`,
      "",
      `Um alarme ${severidade} foi disparado numa estação de ${evento.municipio}.`,
      "",
      `Estação: ${estacao}`,
      `Sensor: ${sensor}`,
      `Regra: ${alarme?.regra_nome ?? evento.regra_id}`,
      `Valor medido: ${numero(evento.valor)}${unidade} (limite ${evento.operador} ${numero(evento.limite)}${unidade})`,
      `Horário da leitura: ${horario(evento.lido_em)} (horário de Brasília)`,
      "",
      "Acompanhe na tela de Alarmes do Pulso Urbano.",
    ].join("\n"),
  };
}

/**
 * US-23 (TASK 23.03): envia o aviso registrado a cada gestor, com até 3
 * tentativas por destinatário, registrando cada uma. Aviso já enviado (evento
 * entregue de novo) não é enviado outra vez.
 */
export const enviarAvisos = async (
  evento: EventoAlarmeDisparado,
  avisos: AvisoRegistrado[],
  opcoes: OpcoesEnvio = {}
): Promise<ResultadoEnvio> => {
  const enviar = opcoes.enviarEmail ?? enviarPorSmtp;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const agora = opcoes.agora ?? (() => new Date());
  const buscarAlarme = opcoes.buscarAlarme ?? findAlarmeById;
  const resultado: ResultadoEnvio = { enviados: 0, falharam: 0 };

  const pendentes = avisos.filter(({ notificacao }) => notificacao.situacao !== "enviado");
  if (pendentes.length === 0) {
    return resultado;
  }

  // Sem os nomes (alarme ainda não visível, por exemplo) o aviso sai com os ids.
  const alarme = await buscarAlarme(evento.alarme_id).catch(() => null);

  for (const { notificacao, gestor } of pendentes) {
    const mensagem = montarEmail(evento, alarme, gestor);
    let enviado = false;

    for (let tentativa = notificacao.tentativas + 1; tentativa <= MAXIMO_TENTATIVAS; tentativa++) {
      try {
        await enviar(mensagem);
        await registrarEnvio(notificacao.id, agora());
        enviado = true;
        logger.info("Aviso de alarme enviado", {
          alarme_id: evento.alarme_id,
          destinatario_id: gestor.id,
          tentativa,
        });
        break;
      } catch (erro) {
        const esgotou = tentativa >= MAXIMO_TENTATIVAS;
        const descricao = erro instanceof Error ? erro.message : String(erro);
        await registrarFalha(notificacao.id, descricao, esgotou);
        logger.warn("Falha ao enviar aviso de alarme", {
          alarme_id: evento.alarme_id,
          destinatario_id: gestor.id,
          tentativa,
          esgotou,
          erro: descricao,
        });
        if (!esgotou) {
          await esperar(ESPERA_ENTRE_TENTATIVAS_MS * tentativa);
        }
      }
    }

    if (enviado) {
      resultado.enviados += 1;
    } else {
      resultado.falharam += 1;
    }
  }

  return resultado;
};
