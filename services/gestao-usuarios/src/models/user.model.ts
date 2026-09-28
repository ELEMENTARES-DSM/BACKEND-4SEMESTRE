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

// Resultado do GET /usuarios, com o nome do papel via JOIN.
// Por design, essa query nunca seleciona senha_hash do banco.
export type UsuarioComPapel = Omit<Usuario, "senha_hash"> & {
  papel_nome: string;
};