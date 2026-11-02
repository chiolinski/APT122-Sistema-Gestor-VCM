SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.Auditoria', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Auditoria (
    auditoria_id bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_Auditoria PRIMARY KEY,
    usuario_id uniqueidentifier NULL,
    usuario_correo nvarchar(320) NOT NULL,
    accion varchar(60) NOT NULL,
    entidad varchar(60) NOT NULL,
    entidad_id nvarchar(100) NULL,
    descripcion nvarchar(500) NOT NULL,
    datos nvarchar(max) NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Auditoria_creado_en DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Auditoria_Usuario FOREIGN KEY (usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_Auditoria_datos_json CHECK (datos IS NULL OR ISJSON(datos) = 1)
  );

  CREATE INDEX IX_Auditoria_creado_en ON vcm.Auditoria(creado_en DESC);
  CREATE INDEX IX_Auditoria_entidad ON vcm.Auditoria(entidad, entidad_id, creado_en DESC);
END;
GO
