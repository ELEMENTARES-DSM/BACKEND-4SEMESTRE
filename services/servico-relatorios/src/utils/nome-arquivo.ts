// "São José dos Campos" → "sao-jose-dos-campos"
export function nomeNoEndereco(municipio: string): string {
  return municipio.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function nomeArquivoCsv(municipio: string, inicio: string, fim: string): string {
  return `pulso-urbano_medicoes_${nomeNoEndereco(municipio)}_${inicio}_${fim}.csv`;
}
