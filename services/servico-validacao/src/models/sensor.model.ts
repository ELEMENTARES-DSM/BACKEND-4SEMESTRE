export interface SensorDaEstacao {
  id: string;
  codigo: string;
  status: "Ativo" | "Inativo";
  fator: number;
  ganho: number;
}
