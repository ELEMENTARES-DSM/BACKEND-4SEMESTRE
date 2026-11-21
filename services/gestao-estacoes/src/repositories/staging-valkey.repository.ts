import { valkey } from "../config/valkey";

/**
 * Leitura do staging que a ingestão-dados mantém no Valkey (US-40): cada
 * mensagem é um hash `staging:msg:{id}` com os campos topico, conteudo (o
 * payload como chegou), recebidoEm e status. Este serviço só LÊ, e só o que
 * precisa para listar os códigos de sensor que uma estação já enviou. Quem
 * escreve e dá nome aos campos é a ingestão-dados.
 */
export const PADRAO_MENSAGENS = "staging:msg:*";

// Quantas chaves cada rodada do SCAN pede ao Valkey (é uma dica, não um limite).
const CHAVES_POR_RODADA = 500;

// Só vale a mensagem que já passou na verificação da ingestão (estação existe,
// payload e horário válidos). "recebida" ainda não foi verificada, "recusada" não
// passou e "duplicada" repete outra que já está contada.
const STATUS_VERIFICADOS = new Set(["pendente", "encaminhada"]);

export interface MensagemVerificada {
  /** Payload exatamente como a estação enviou. */
  payloadBruto: string;
  /** Quando a ingestão recebeu, em ISO 8601. */
  recebidoEm: string;
}

/** O MAC do tópico é aceito em maiúsculas ou minúsculas pela ingestão. */
const topicoDaEstacao = (macAddress: string): string =>
  `pulso/estacoes/${macAddress}/telemetria`.toLowerCase();

/**
 * Mensagens verificadas de uma estação que ainda estão no staging (a
 * ingestão as guarda por 7 dias depois de encaminhadas).
 *
 * Varre as chaves com SCAN, que anda aos poucos e não trava o Valkey, e lê
 * primeiro só o tópico e o status; o payload só é trazido das mensagens da
 * estação pedida. Se o Valkey estiver fora, o erro sobe para quem chamou.
 */
export const listarMensagensVerificadas = async (
  macAddress: string
): Promise<MensagemVerificada[]> => {
  const cliente = await valkey();
  const topico = topicoDaEstacao(macAddress);
  const jaVistas = new Set<string>();
  const mensagens: MensagemVerificada[] = [];
  let cursor = 0;

  do {
    const rodada = await cliente.scan(cursor, {
      MATCH: PADRAO_MENSAGENS,
      COUNT: CHAVES_POR_RODADA,
    });
    cursor = Number(rodada.cursor);

    // O SCAN pode devolver a mesma chave em rodadas diferentes.
    const novas = rodada.keys.filter((chave) => !jaVistas.has(chave));
    novas.forEach((chave) => jaVistas.add(chave));

    const cabecalhos = await Promise.all(
      novas.map((chave) => cliente.hmGet(chave, ["topico", "status"]))
    );
    const daEstacao = novas.filter((_, i) => {
      const [topicoDaMensagem, status] = cabecalhos[i];
      return (
        topicoDaMensagem?.toLowerCase() === topico &&
        status != null &&
        STATUS_VERIFICADOS.has(status)
      );
    });

    const conteudos = await Promise.all(
      daEstacao.map((chave) => cliente.hmGet(chave, ["conteudo", "recebidoEm"]))
    );
    for (const [payloadBruto, recebidoEm] of conteudos) {
      // Chave que expirou entre o SCAN e a leitura volta vazia.
      if (payloadBruto != null && recebidoEm != null) {
        mensagens.push({ payloadBruto, recebidoEm });
      }
    }
  } while (cursor !== 0);

  return mensagens;
};
