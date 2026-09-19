export const up = (pgm) => {
    pgm.createTable("sensores", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },

        estacao_id: {
            type: "uuid",
            notNull: true,
            references: "estacoes",
            onDelete: "RESTRICT",
        },

        codigo: {
            type: "varchar(30)",
            notNull: true,
        },

        nome: {
            type: "varchar(100)",
            notNull: true,
        },

        grandeza: {
            type: "varchar(50)",
            notNull: true,
        },

        unidade: {
            type: "varchar(20)",
            notNull: true,
        },

        status: {
            type: "varchar(20)",
            notNull: true,
            default: "Ativo",
        },

        criado_em: {
            type: "timestamp",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // Cada sensor é identificado de forma única pela combinação estação + código.
    pgm.addConstraint(
        "sensores",
        "sensores_estacao_codigo_unique",
        {
            unique: ["estacao_id", "codigo"],
        }
    );

    // Validação das grandezas físicas suportadas pelo sistema.
    pgm.addConstraint(
        "sensores",
        "sensores_grandeza_check",
        {
            check: "grandeza IN ('TEMPERATURA', 'UMIDADE', 'PRESSAO', 'CHUVA', 'VENTO', 'PM25')",
        }
    );

    // Otimiza consultas de sensores por estação.
    pgm.createIndex("sensores", "estacao_id");
};

export const down = (pgm) => {
    // Remove índices e constraints explicitamente antes do dropTable,
    // garantindo uma reversão limpa e sem dependências pendentes.
    pgm.dropIndex("sensores", "sensores_estacao_id_idx");
    pgm.dropConstraint("sensores", "sensores_estacao_codigo_unique");
    pgm.dropConstraint("sensores", "sensores_grandeza_check");

    pgm.dropTable("sensores");
};