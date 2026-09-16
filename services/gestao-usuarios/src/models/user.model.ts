export interface Usuario {
  id: string;
  nome: string;
  email: string;
  senha_hash: string;
  papel_id: string;
  municipio: string | null;
  esta_ativo: boolean;
  criado_em: Date;
  atualizado_em: Date;
}

// Formato seguro pra devolver na API — nunca inclui senha_hash.
export type UsuarioPublico = Omit<Usuario, "senha_hash">;