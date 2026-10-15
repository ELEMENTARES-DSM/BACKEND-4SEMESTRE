export const STATUS_RECEBIDA = "recebida";

// Precisa bater com o WHERE do índice uq_staging_estacao_unixtime
// (e com o ON CONFLICT do repository): linhas rejeitadas não bloqueiam a chave.
export const STATUS_REJEITADA = "rejeitada";
