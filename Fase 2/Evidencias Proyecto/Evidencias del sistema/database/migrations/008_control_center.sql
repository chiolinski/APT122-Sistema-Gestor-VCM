SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.NotificacionVista', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.NotificacionVista (
    usuario_id uniqueidentifier NOT NULL,
    clave nvarchar(200) NOT NULL,
    leida_en datetime2(0) NOT NULL CONSTRAINT DF_NotificacionVista_Leida DEFAULT SYSUTCDATETIME(),
    actualizada_en datetime2(0) NOT NULL CONSTRAINT DF_NotificacionVista_Actualizada DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_NotificacionVista PRIMARY KEY (usuario_id, clave),
    CONSTRAINT FK_NotificacionVista_Usuario FOREIGN KEY (usuario_id) REFERENCES vcm.Usuario(usuario_id) ON DELETE CASCADE
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_NotificacionVista_UsuarioLeida'
    AND object_id = OBJECT_ID('vcm.NotificacionVista')
)
  CREATE INDEX IX_NotificacionVista_UsuarioLeida
    ON vcm.NotificacionVista(usuario_id, leida_en DESC);
GO
