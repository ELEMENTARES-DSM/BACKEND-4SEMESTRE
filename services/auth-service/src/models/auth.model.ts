export interface UsuarioAuth {
  id: string;
  nome: string;
  senha_hash: string;
  municipio: string | null;
  esta_ativo: boolean;
  papel: string;
}