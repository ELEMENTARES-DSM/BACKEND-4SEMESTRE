import { existeEstacaoNoMunicipio } from "../repositories/medicoes.repository";

// Escolhem o município no pedido; sem ele, usam o do token. A 42.03 traz o PESQUISADOR de volta.
export const PAPEIS_QUE_ESCOLHEM_MUNICIPIO = ["ADMINISTRADOR", "PESQUISADOR", "MUNICIPE"];

export const MUNICIPIO_NAO_ENCONTRADO = "Município não encontrado.";

export class ErroPedido extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface UsuarioDoToken {
  papel: string;
  municipio: string | null;
}

// US-31 Cenário 4: o gestor pedindo outro município recebe o mesmo 404 do município inexistente.
export async function municipioDoPedido(usuario: UsuarioDoToken, pedido?: string): Promise<string> {
  let municipio: string | null | undefined;

  if (usuario.papel === "GESTOR_PUBLICO") {
    if (!usuario.municipio) throw new ErroPedido(403, "Gestor sem município associado.");
    if (pedido && pedido !== usuario.municipio) throw new ErroPedido(404, MUNICIPIO_NAO_ENCONTRADO);
    municipio = usuario.municipio;
  } else if (PAPEIS_QUE_ESCOLHEM_MUNICIPIO.includes(usuario.papel)) {
    municipio = pedido ?? usuario.municipio;
  } else {
    throw new ErroPedido(403, "Acesso negado. Perfil insuficiente para esta ação.");
  }

  if (!municipio) throw new ErroPedido(400, "Informe o município.");
  if (!(await existeEstacaoNoMunicipio(municipio))) throw new ErroPedido(404, MUNICIPIO_NAO_ENCONTRADO);
  return municipio;
}
