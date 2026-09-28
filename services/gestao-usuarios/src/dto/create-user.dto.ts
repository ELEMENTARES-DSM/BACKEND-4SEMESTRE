export interface CreateUserDTO {
  nome: string;
  email: string;
  senha: string;
  papel_id: string;
  municipio?: string;
}