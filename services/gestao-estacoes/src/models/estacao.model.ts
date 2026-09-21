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