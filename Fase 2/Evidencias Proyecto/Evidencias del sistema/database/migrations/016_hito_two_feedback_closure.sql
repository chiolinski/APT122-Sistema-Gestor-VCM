-- Registro de la retroalimentación que el docente revisó al cerrar Hito 2.
-- Aditivo: no reabre hitos ni modifica avances históricos.
SET XACT_ABORT ON;
GO
IF OBJECT_ID('vcm.RevisionSocio', 'U') IS NULL
  THROW 52600, 'Primero debe aplicarse 015_partner_reviews.sql.', 1;
GO
IF OBJECT_ID('vcm.EntregaVideoEquipo', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.EntregaVideoEquipo (
    entrega_video_equipo_id uniqueidentifier NOT NULL CONSTRAINT PK_EntregaVideoEquipo PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    equipo_id uniqueidentifier NOT NULL,
    token_hash char(64) NOT NULL CONSTRAINT UQ_EntregaVideoEquipo_Token UNIQUE,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_EntregaVideoEquipo_Creado DEFAULT SYSUTCDATETIME(),
    vence_en datetime2(0) NOT NULL,
    revocado_en datetime2(0) NULL,
    archivo_nombre nvarchar(260) NULL,
    blob_confirmado nvarchar(500) NULL,
    tamano_bytes bigint NULL,
    entregado_en datetime2(0) NULL,
    intento_id uniqueidentifier NULL,
    blob_pendiente nvarchar(500) NULL,
    nombre_pendiente nvarchar(260) NULL,
    tamano_esperado bigint NULL,
    intento_vence_en datetime2(0) NULL,
    CONSTRAINT FK_EntregaVideoEquipo_ProyectoSeccion FOREIGN KEY (proyecto_id, seccion_id)
      REFERENCES vcm.ProyectoSeccion(proyecto_id, seccion_id) ON DELETE CASCADE,
    CONSTRAINT CK_EntregaVideoEquipo_Tamano CHECK (tamano_bytes IS NULL OR tamano_bytes > 0)
  );
  -- Sin FK al equipo mutable: se conserva el historial si se reorganiza la nómina.
  CREATE INDEX IX_EntregaVideoEquipo_Seccion ON vcm.EntregaVideoEquipo(proyecto_id, seccion_id, equipo_id, creado_en DESC);
END;
GO
IF COL_LENGTH('vcm.AvanceProyectoSeccion', 'revision_socio_id') IS NULL
  ALTER TABLE vcm.AvanceProyectoSeccion ADD revision_socio_id uniqueidentifier NULL;
GO
IF COL_LENGTH('vcm.AvanceProyectoSeccion', 'retroalimentacion_revisada_en') IS NULL
  ALTER TABLE vcm.AvanceProyectoSeccion ADD retroalimentacion_revisada_en datetime2(0) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_AvanceProyectoSeccion_RevisionSocio')
  ALTER TABLE vcm.AvanceProyectoSeccion WITH CHECK ADD CONSTRAINT FK_AvanceProyectoSeccion_RevisionSocio
    FOREIGN KEY (revision_socio_id) REFERENCES vcm.RevisionSocio(revision_socio_id);
GO
