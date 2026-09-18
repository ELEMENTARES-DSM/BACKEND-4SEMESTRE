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
            type: "varchar(100)",
            notNull: true,
        },

        municipio: {
            type: "varchar(100)",
            notNull: true,
        },

        latitude: {
            type: "numeric(10,6)",
            notNull: true,
        },

        longitude: {
            type: "numeric(10,6)",
            notNull: true,
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

    // Código pode se repetir em municípios diferentes,
    // mas não dentro do mesmo município.
    pgm.addConstraint(
        "estacoes",
        "estacoes_codigo_municipio_unique",
        {
            unique: ["codigo", "municipio"],
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
    pgm.dropTable("estacoes");
};