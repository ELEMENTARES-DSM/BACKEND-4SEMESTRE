import {
  MensagemIngestaoInput,
  PayloadLeituraValidado,
} from "../dto/mensagem-ingestao.dto";

export interface ResultadoValidacaoPayload {
  sucesso: boolean;
  motivoRejeicao?: string;
  payloadValidado?: PayloadLeituraValidado;
}

export class ValidarPayloadService {
  public validar(mensagem: MensagemIngestaoInput): ResultadoValidacaoPayload {
    let jsonParsed: Record<string, unknown>;

    try {
      jsonParsed = JSON.parse(mensagem.payloadBruto);
    } catch {
      return {
        sucesso: false,
        motivoRejeicao: "Payload malformado",
      };
    }

    if (
      typeof jsonParsed !== "object" ||
      jsonParsed === null ||
      Array.isArray(jsonParsed)
    ) {
      return {
        sucesso: false,
        motivoRejeicao: "Payload malformado",
      };
    }

    const { timestamp, leituras, nivel_bateria } = jsonParsed;

    if (!timestamp || typeof timestamp !== "string") {
      return {
        sucesso: false,
        motivoRejeicao: "Timestamp ausente ou inválido",
      };
    }

    const dataValida = !isNaN(Date.parse(timestamp));
    if (!dataValida) {
      return {
        sucesso: false,
        motivoRejeicao: "Timestamp ausente ou inválido",
      };
    }

    if (!leituras || !Array.isArray(leituras) || leituras.length === 0) {
      return {
        sucesso: false,
        motivoRejeicao: "Lista de leituras ausente ou vazia",
      };
    }

    for (const item of leituras) {
      if (
        !item ||
        typeof item.sensor !== "string" ||
        item.sensor.trim() === "" ||
        typeof item.valor !== "number" ||
        isNaN(item.valor)
      ) {
        return {
          sucesso: false,
          motivoRejeicao: "Leitura inválida: sensor ou valor ausente",
        };
      }
    }

    if (nivel_bateria !== undefined && nivel_bateria !== null) {
      if (
        typeof nivel_bateria !== "number" ||
        !Number.isInteger(nivel_bateria) ||
        nivel_bateria < 0 ||
        nivel_bateria > 100
      ) {
        return {
          sucesso: false,
          motivoRejeicao: "Nível de bateria fora de 0 a 100",
        };
      }
    }

    return {
      sucesso: true,
      payloadValidado: {
        timestamp,
        leituras,
        nivel_bateria: nivel_bateria ?? undefined,
      },
    };
  }
}
