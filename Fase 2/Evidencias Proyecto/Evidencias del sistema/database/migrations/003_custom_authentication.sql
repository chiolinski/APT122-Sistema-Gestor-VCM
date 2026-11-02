IF COL_LENGTH('vcm.Usuario', 'password_hash') IS NULL
  ALTER TABLE vcm.Usuario ADD password_hash nvarchar(255) NULL;
IF COL_LENGTH('vcm.Usuario', 'password_actualizado_en') IS NULL
  ALTER TABLE vcm.Usuario ADD password_actualizado_en datetime2(0) NULL;
IF COL_LENGTH('vcm.Usuario', 'ultimo_acceso_en') IS NULL
  ALTER TABLE vcm.Usuario ADD ultimo_acceso_en datetime2(0) NULL;
IF COL_LENGTH('vcm.Usuario', 'intentos_fallidos') IS NULL
  ALTER TABLE vcm.Usuario ADD intentos_fallidos tinyint NOT NULL CONSTRAINT DF_Usuario_IntentosFallidos DEFAULT 0;
IF COL_LENGTH('vcm.Usuario', 'bloqueado_hasta') IS NULL
  ALTER TABLE vcm.Usuario ADD bloqueado_hasta datetime2(0) NULL;
GO

IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UQ_Usuario_Identidad'
    AND parent_object_id = OBJECT_ID('vcm.Usuario')
)
  ALTER TABLE vcm.Usuario DROP CONSTRAINT UQ_Usuario_Identidad;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_Usuario_IdentidadExterna'
    AND object_id = OBJECT_ID('vcm.Usuario')
)
  CREATE UNIQUE INDEX UX_Usuario_IdentidadExterna
    ON vcm.Usuario(identidad_externa_id)
    WHERE identidad_externa_id IS NOT NULL;
GO

IF OBJECT_ID('vcm.SesionUsuario', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.SesionUsuario (
    sesion_usuario_id uniqueidentifier NOT NULL CONSTRAINT PK_SesionUsuario PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    usuario_id uniqueidentifier NOT NULL,
    token_hash char(64) NOT NULL CONSTRAINT UQ_SesionUsuario_Token UNIQUE,
    user_agent nvarchar(300) NULL,
    direccion_ip varchar(64) NULL,
    creada_en datetime2(0) NOT NULL CONSTRAINT DF_SesionUsuario_Creada DEFAULT SYSUTCDATETIME(),
    ultimo_uso_en datetime2(0) NOT NULL CONSTRAINT DF_SesionUsuario_UltimoUso DEFAULT SYSUTCDATETIME(),
    expira_en datetime2(0) NOT NULL,
    CONSTRAINT FK_SesionUsuario_Usuario FOREIGN KEY (usuario_id) REFERENCES vcm.Usuario(usuario_id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SesionUsuario_UsuarioExpiracion' AND object_id = OBJECT_ID('vcm.SesionUsuario'))
  CREATE INDEX IX_SesionUsuario_UsuarioExpiracion ON vcm.SesionUsuario(usuario_id, expira_en);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_SesionUsuario_Expiracion' AND object_id = OBJECT_ID('vcm.SesionUsuario'))
  CREATE INDEX IX_SesionUsuario_Expiracion ON vcm.SesionUsuario(expira_en);
GO
