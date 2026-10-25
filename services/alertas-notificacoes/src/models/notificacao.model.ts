export const CANAIS_NOTIFICACAO = ["email"] as const;
export const SITUACOES_NOTIFICACAO = ["pendente", "enviado", "falhou"] as const;

export type CanalNotificacao = (typeof CANAIS_NOTIFICACAO)[number];
export type SituacaoNotificacao = (typeof SITUACOES_NOTIFICACAO)[number];

export interface Notificacao {
  id: string;
  alarme_id: string;
  destinatario_id: string;
  canal: CanalNotificacao;
  situacao: SituacaoNotificacao;
  tentativas: number;
  ultimo_erro: string | null;
  criado_em: Date;
  enviado_em: Date | null;
}

/** Gestor público ativo, lido de usuarios e papeis (tabelas do gestao-usuarios). */
export interface GestorAtivo {
  id: string;
  nome: string;
  email: string;
}
