export interface UpdateEstacaoDTO {
  mac_address?: string;
  nome?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  nivel_bateria?: number | null;
  ultimo_ping?: Date | null;
}