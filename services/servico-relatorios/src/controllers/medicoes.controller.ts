import { Request, Response } from "express";
import {
  buscarMedicoes,
  contarMedicoes,
  FiltrosMedicoes,
  LinhaMedicao,
} from "../repositories/medicoes.repository";
import { escreverCsv } from "../services/gerar-csv.service";
import { ErroPedido, municipioDoPedido } from "../services/municipio-do-pedido";
import type { UsuarioPayload } from "../types/express";
import logger from "../utils/logger";
import { nomeArquivoCsv } from "../utils/nome-arquivo";
import { periodo } from "../utils/periodo";
import { validarFiltrosMedicoes } from "../validations/medicoes.validation";

// JSON para o dev: horário em ISO 8601 (UTC) e números com ponto.
const medicaoJson = (l: LinhaMedicao) => ({
  lidoEm: new Date(Number(l.unixtime) * 1000).toISOString().replace(".000Z", "Z"),
  estacaoCodigo: l.estacao_codigo,
  estacaoNome: l.estacao_nome,
  municipio: l.municipio,
  sensorCodigo: l.sensor_codigo,
  grandeza: l.grandeza,
  unidade: l.unidade,
  valor: Number(l.valor),
  valorBruto: Number(l.valor_bruto),
  valida: l.valida,
});

export const listarMedicoes = async (req: Request, res: Response): Promise<void> => {
  // Os dados mudam a cada 5 minutos e dependem do perfil.
  res.set("Cache-Control", "no-store");

  const validacao = validarFiltrosMedicoes(req.query);
  if (!validacao.sucesso) {
    res.status(400).json({ erro: validacao.erro });
    return;
  }
  const pedido = validacao.filtros;

  let municipio: string;
  try {
    municipio = await municipioDoPedido(req.usuario as UsuarioPayload, pedido.municipio);
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      res.status(erro.status).json({ erro: erro.message });
      return;
    }
    throw erro;
  }

  const filtros: FiltrosMedicoes = {
    municipio,
    ...periodo(pedido.inicio, pedido.fim),
    estacoes: pedido.estacao,
    grandezas: pedido.grandeza,
  };

  if (pedido.formato === "csv") {
    // O CSV traz o período inteiro: `pagina` e `porPagina` são ignorados.
    res.status(200).set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivoCsv(municipio, pedido.inicio, pedido.fim)}"`,
    });
    try {
      await escreverCsv(filtros, res);
      res.end();
    } catch (erro) {
      // Encerrar a conexão faz o navegador mostrar falha em vez de salvar um arquivo cortado.
      logger.error("Falha ao gerar o CSV das medições", {
        municipio,
        inicio: pedido.inicio,
        fim: pedido.fim,
        erro: erro instanceof Error ? erro.message : String(erro),
      });
      res.destroy();
    }
    return;
  }

  const [total, linhas] = await Promise.all([
    contarMedicoes(filtros),
    buscarMedicoes(filtros, pedido),
  ]);
  res.status(200).json({
    municipio,
    inicio: pedido.inicio,
    fim: pedido.fim,
    pagina: pedido.pagina,
    porPagina: pedido.porPagina,
    total,
    medicoes: linhas.map(medicaoJson),
  });
};
