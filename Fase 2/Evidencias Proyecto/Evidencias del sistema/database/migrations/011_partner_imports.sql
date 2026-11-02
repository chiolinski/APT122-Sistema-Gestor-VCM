SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.CargaSocioFormador', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.CargaSocioFormador (
    carga_socio_formador_id uniqueidentifier NOT NULL
      CONSTRAINT PK_CargaSocioFormador PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    nombre_archivo nvarchar(260) NOT NULL,
    hash_sha256 char(64) NOT NULL CONSTRAINT UQ_CargaSocioFormador_Hash UNIQUE,
    estado varchar(20) NOT NULL CONSTRAINT DF_CargaSocioFormador_Estado DEFAULT 'PROCESANDO',
    total_filas int NOT NULL CONSTRAINT DF_CargaSocioFormador_Filas DEFAULT 0,
    total_socios int NOT NULL CONSTRAINT DF_CargaSocioFormador_Socios DEFAULT 0,
    total_creados int NOT NULL CONSTRAINT DF_CargaSocioFormador_Creados DEFAULT 0,
    total_actualizados int NOT NULL CONSTRAINT DF_CargaSocioFormador_Actualizados DEFAULT 0,
    total_duplicados int NOT NULL CONSTRAINT DF_CargaSocioFormador_Duplicados DEFAULT 0,
    total_advertencias int NOT NULL CONSTRAINT DF_CargaSocioFormador_Advertencias DEFAULT 0,
    aplicado_por_usuario_id uniqueidentifier NULL,
    aplicado_por nvarchar(320) NOT NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_CargaSocioFormador_Creado DEFAULT SYSUTCDATETIME(),
    aplicado_en datetime2(0) NULL,
    CONSTRAINT FK_CargaSocioFormador_Usuario FOREIGN KEY (aplicado_por_usuario_id)
      REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_CargaSocioFormador_Estado CHECK (estado IN ('PROCESANDO', 'APLICADA', 'ERROR'))
  );

  CREATE INDEX IX_CargaSocioFormador_Creado
    ON vcm.CargaSocioFormador(creado_en DESC);
END;
GO
