export type OperadorRegraAlerta = ">" | ">=" | "<" | "<=" | "=";
export type SeveridadeRegraAlerta = "ATENCAO" | "ALERTA" | "CRITICO";

export interface Alerta {
  id: string;
  sensor_id: string;
  nome: string;
  operador: OperadorRegraAlerta;
  valor_limite: number;
  severidade: SeveridadeRegraAlerta;
  fator: number;
  ganho: number;
  esta_ativo: boolean;
}
