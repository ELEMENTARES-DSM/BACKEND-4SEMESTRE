export type OperadorRegraAlerta = ">" | ">=" | "<" | "<=" | "=";
export type SeveridadeRegraAlerta = "ATENCAO" | "ALERTA" | "CRITICO";
export type StatusRegraAlerta = "Ativa" | "Inativa";
export interface Alerta {
  id: string;
  sensor_id: string;
  operador: OperadorRegraAlerta;
  limiar: number;
  severidade: SeveridadeRegraAlerta;
  status: StatusRegraAlerta;
  criado_em: Date;
}
