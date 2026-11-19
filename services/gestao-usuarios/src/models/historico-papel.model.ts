export interface HistoricoTrocaPapel {
  id: string;
  usuario_id: string;
  papel_anterior_id: string;
  papel_novo_id: string;
  alterado_por: string;
  criado_em: Date;
}

export interface HistoricoTrocaPapelDetalhado extends HistoricoTrocaPapel {
  papel_anterior_nome?: string;
  papel_novo_nome?: string;
  alterado_por_nome?: string;
}
