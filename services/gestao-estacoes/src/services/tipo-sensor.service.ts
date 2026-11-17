import * as tipoSensorRepository from "../repositories/tipo-sensor.repository";
import { CreateTipoSensorDTO } from "../dto/create-tipo-sensor.dto";
import { UpdateTipoSensorDTO } from "../dto/update-tipo-sensor.dto";
import { TipoSensorCatalogo } from "../models/tipo-sensor.model";
import { AppError } from "../middlewares/error-handler";

const NAO_ENCONTRADA = "Grandeza não encontrada no catálogo.";

const sensoresEm = (total: number) =>
  total === 1 ? "1 sensor" : `${total} sensores`;

const erroDeUnidadeEmUso = async (nome: string) => {
  const total = await tipoSensorRepository.contarSensoresDaGrandeza(nome);
  return new AppError(
    `A unidade não pode ser alterada: esta grandeza é usada por ${sensoresEm(total)}. ` +
      "Faixa e agregação podem ser alteradas a qualquer momento.",
    409
  );
};

const erroDeExclusaoEmUso = async (nome: string) => {
  const total = await tipoSensorRepository.contarSensoresDaGrandeza(nome);
  return new AppError(
    `Esta grandeza é usada por ${sensoresEm(total)} e não pode ser excluída. ` +
      "Sensores com medidas não podem ser removidos; para parar de usá-la, inative os sensores.",
    409
  );
};

export const listar = async (): Promise<TipoSensorCatalogo[]> => {
  return tipoSensorRepository.findAll();
};

/**
 * Busca a grandeza no catálogo pelo nome. Nome fora do catálogo: 400 com
 * mensagem clara (o cadastro de sensor não aceita grandeza que não existe).
 */
export const obterPorNome = async (
  nome: string
): Promise<TipoSensorCatalogo> => {
  const tipo = await tipoSensorRepository.findByNome(nome);

  if (!tipo) {
    throw new AppError(
      `Tipo de sensor "${nome}" não existe no catálogo de grandezas.`,
      400
    );
  }

  return tipo;
};

export const criar = async (
  data: CreateTipoSensorDTO
): Promise<TipoSensorCatalogo> => {
  if (data.faixa_min >= data.faixa_max) {
    throw new AppError("faixa_min deve ser menor que faixa_max.", 400);
  }

  const existente = await tipoSensorRepository.findByNome(data.nome);
  if (existente) {
    throw new AppError(
      `Já existe uma grandeza com o nome "${data.nome}" no catálogo.`,
      409
    );
  }

  return tipoSensorRepository.create(data);
};

/**
 * Altera faixa e agregação sempre (valem só para leituras futuras: as medidas
 * já gravadas não mudam) e a unidade só se nenhum sensor usa a grandeza. O nome
 * é fixo. A conferência "nenhum sensor usa" e a troca da unidade são uma única
 * instrução SQL no repository, sem janela entre conferir e gravar.
 */
export const atualizar = async (
  id: string,
  data: UpdateTipoSensorDTO
): Promise<TipoSensorCatalogo> => {
  const atual = await tipoSensorRepository.findById(id);
  if (!atual) {
    throw new AppError(NAO_ENCONTRADA, 404);
  }

  const faixaMin = data.faixa_min ?? Number(atual.faixa_min);
  const faixaMax = data.faixa_max ?? Number(atual.faixa_max);
  if (faixaMin >= faixaMax) {
    throw new AppError("faixa_min deve ser menor que faixa_max.", 400);
  }

  // Repetir a unidade atual não é uma troca: não exige que a grandeza esteja livre.
  const trocaUnidade = data.unidade !== undefined && data.unidade !== atual.unidade;
  const campos: UpdateTipoSensorDTO = {
    ...data,
    unidade: trocaUnidade ? data.unidade : undefined,
  };

  if (Object.values(campos).every((valor) => valor === undefined)) {
    return atual;
  }

  const atualizado = await tipoSensorRepository.update(id, campos, trocaUnidade);
  if (atualizado) {
    return atualizado;
  }

  // Nenhuma linha afetada: ou a grandeza sumiu entre a leitura e a troca, ou está em uso.
  const aindaExiste = await tipoSensorRepository.findById(id);
  if (!aindaExiste) {
    throw new AppError(NAO_ENCONTRADA, 404);
  }
  throw await erroDeUnidadeEmUso(atual.nome);
};

/**
 * Exclui a grandeza só se nenhum sensor a usa. Grandeza que já teve sensor com
 * medida não sai mais do catálogo (sensor não é apagável e as medidas prendem o
 * sensor): para parar de usá-la, os sensores são inativados.
 */
export const excluir = async (id: string): Promise<void> => {
  const atual = await tipoSensorRepository.findById(id);
  if (!atual) {
    throw new AppError(NAO_ENCONTRADA, 404);
  }

  if ((await tipoSensorRepository.contarSensoresDaGrandeza(atual.nome)) > 0) {
    throw await erroDeExclusaoEmUso(atual.nome);
  }

  try {
    const apagou = await tipoSensorRepository.remove(id);
    if (!apagou) {
      throw new AppError(NAO_ENCONTRADA, 404);
    }
  } catch (err) {
    // Rede de segurança: um sensor passou a usar a grandeza depois da contagem.
    if ((err as { code?: string }).code === "23503") {
      throw await erroDeExclusaoEmUso(atual.nome);
    }
    throw err;
  }
};
