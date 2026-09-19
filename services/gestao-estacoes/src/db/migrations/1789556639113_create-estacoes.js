export const up = (pgm) => {
    pgm.createTable("estacoes", {
        id: {
            type: "uuid",
            primaryKey: true,
            default: pgm.func("gen_random_uuid()"),
        },

        codigo: {
            type: "varchar(30)",
            notNull: true,
        },

        nome: {
            type: "varchar(120)",
            notNull: true,
        },

        municipio: {
            type: "varchar(100)",
            notNull: true,
        },

        latitude: {
            type: "numeric(9,6)",
            notNull: true,
        },

        longitude: {
            type: "numeric(9,6)",
            notNull: true,
        },

        nivel_bateria: {
            type: "integer",
            notNull: false,
        },

        ultimo_ping: {
            type: "timestamp",
            notNull: false,
        },

        status: {
            type: "varchar(20)",
            notNull: true,
            default: "Ativa",
        },

        criado_em: {
            type: "timestamp",
            notNull: true,
            default: pgm.func("CURRENT_TIMESTAMP"),
        },
    });

    // O campo codigo deve ser único globalmente na base (UNIQUE).
    pgm.addConstraint(
        "estacoes",
        "estacoes_codigo_unique",
        {
            unique: ["codigo"],
        }
    );

    // Latitude válida: -90 até 90
    pgm.addConstraint(
        "estacoes",
        "estacoes_latitude_check",
        {
            check: "latitude BETWEEN -90.0 AND 90.0",
        }
    );

    // Longitude válida: -180 até 180
    pgm.addConstraint(
        "estacoes",
        "estacoes_longitude_check",
        {
            check: "longitude BETWEEN -180.0 AND 180.0",
        }
    );

    // Otimiza consultas por município
    pgm.createIndex("estacoes", "municipio");
};

export const down = (pgm) => {

    pgm.dropIndex("estacoes", "estacoes_municipio_idx");
    pgm.dropConstraint("estacoes", "estacoes_codigo_unique");
    pgm.dropConstraint("estacoes", "estacoes_latitude_check");
    pgm.dropConstraint("estacoes", "estacoes_longitude_check");

    pgm.dropTable("estacoes");
};