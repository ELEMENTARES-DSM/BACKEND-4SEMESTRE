import { pool } from "../config/db";
import { MensagemIngestaoInput } from "../dto/mensagem-ingestao.dto";
import { inserirStaging } from "../repositories/staging.repository";
import { atualizarSinalEstacao } from "../repositories/estacao.repository";
import { ValidarPayloadService } from "./validar-payload.service";
import { solicitarProcessamentoPendentes } from "./staging-publisher.service";
import { protegerCliente } from "../utils/conexao-pg";

export type ResultadoGravacao = "recebida" | "rejeitada" | "duplicata";

const validador = new ValidarPayloadService();

function lerJson(payloadBruto: string): { valido: boolean; valor: unknown } {
  try {
    return {
      valido: true,
      valor: JSON.parse(payloadBruto),
    };
  } catch {
    return {
      valido: false,
      valor: null,
    };
  }
}

function extrairUnixtime(payload: unknown): number | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("timestamp" in payload) ||
    typeof payload.timestamp !== "string"
  ) {
    return null;
  }

  const timestamp = Date.parse(payload.timestamp);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return Math.floor(timestamp / 1000);
}

export async function gravarAceita(
  mensagem: MensagemIngestaoInput,
): Promise<ResultadoGravacao> {
  const validacao = validador.validar(mensagem);

  if (!validacao.sucesso || !validacao.payloadValidado) {
    throw new Error(
      validacao.motivoRejeicao ??
        "Mensagem inválida enviada para gravação como aceita",
    );
  }

  const unixtime = Math.floor(
    Date.parse(validacao.payloadValidado.timestamp) / 1000,
  );

  const client = await pool.connect();
  const liberarCliente = protegerCliente(client, "gravar mensagem aceita no staging");

  try {
    await client.query("BEGIN");

    const gravou = await inserirStaging(
      {
        estacaoId: mensagem.estacaoId,
        unixtime,
        recebidoEm: mensagem.recebidoEm,
        payloadBruto: mensagem.payloadBruto,
        payloadJson: mensagem.payloadBruto,
        status: "recebida",
        motivoRejeicao: null,
      },
      client,
    );

    if (!gravou) {
      await client.query("COMMIT");
      return "duplicata";
    }

    await atualizarSinalEstacao(client, {
      estacaoId: mensagem.estacaoId,
      ultimoPing: mensagem.recebidoEm,
      nivelBateria: validacao.payloadValidado.nivel_bateria,
    });
    await client.query("COMMIT");
    solicitarProcessamentoPendentes();
    return "recebida";
  } catch (erro) {
    // Com a conexão perdida o ROLLBACK também falha; o erro que importa é o original.
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    liberarCliente();
  }
}

export async function gravarRejeitada(
  mensagem: MensagemIngestaoInput,
  motivo: string,
): Promise<ResultadoGravacao> {
  if (!motivo.trim() || motivo.length > 255) {
    throw new Error("O motivo da rejeição deve ter entre 1 e 255 caracteres");
  }

  const json = lerJson(mensagem.payloadBruto);

  await inserirStaging({
    estacaoId: mensagem.estacaoId,
    unixtime: extrairUnixtime(json.valor),
    recebidoEm: mensagem.recebidoEm,
    payloadBruto: mensagem.payloadBruto,
    payloadJson: json.valido ? mensagem.payloadBruto : null,
    status: "rejeitada",
    motivoRejeicao: motivo,
  });

  return "rejeitada";
}
