export interface CadastroMunicipeDTO {
  nome: string;
  email: string;
  senha: string;
  municipio?: string;
  aceite_privacidade: boolean;
}
