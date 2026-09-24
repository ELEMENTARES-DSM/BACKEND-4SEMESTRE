export interface Estacao {
  id: string;
  codigo: string;
  nome: string;
  municipio: string;
}

export type StatusOperacional = "Ativa" | "Com Falha" | "Inativa";

export interface EstacaoComStatusOperacional {
  id: string;
  codigo: string;
  nome: string;
  ultimo_ping: string | null;
  status_operacional: StatusOperacional;
}

export interface ResumoStatus {
  total: number;
  ativas: number;
  com_falha: number;
  inativas: number;
}

export interface StatusEstacoesResponse {
  resumo: ResumoStatus;
  estacoes: EstacaoComStatusOperacional[];
}
export interface Estacoes{
  id: string;
  codigo: string;
  nome: string;
  municipio: string;
  latitude: number;
  longitude: number;
  status: string;
  nivel_bateria: number | null;
  ultimo_ping: Date | null;
  criado_em: Date;
}