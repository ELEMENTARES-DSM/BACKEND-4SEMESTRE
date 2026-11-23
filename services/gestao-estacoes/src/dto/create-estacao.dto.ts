export interface CreateEstacaoDTO {
  mac_address: string;
  codigo: string;
  nome: string;
  municipio: string;
  latitude: number;
  longitude: number;
  status?: string;
  nivel_bateria?: number | null;
  ultimo_ping?: Date | null;
}