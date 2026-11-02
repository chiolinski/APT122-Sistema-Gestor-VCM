SET XACT_ABORT ON;
GO

IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ArchivoProyecto_ProyectoCategoriaSeccion'
    AND object_id = OBJECT_ID('vcm.ArchivoProyecto')
)
  DROP INDEX IX_ArchivoProyecto_ProyectoCategoriaSeccion ON vcm.ArchivoProyecto;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ArchivoProyecto_ProyectoCategoriaSeccion'
    AND object_id = OBJECT_ID('vcm.ArchivoProyecto')
)
  CREATE INDEX IX_ArchivoProyecto_ProyectoCategoriaSeccion
    ON vcm.ArchivoProyecto(proyecto_id, categoria, seccion_id, subido_en DESC);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_ArchivoProyecto_EntregableSeccion'
    AND object_id = OBJECT_ID('vcm.ArchivoProyecto')
)
  CREATE UNIQUE INDEX UX_ArchivoProyecto_EntregableSeccion
    ON vcm.ArchivoProyecto(proyecto_id, seccion_id)
    WHERE categoria = 'ENTREGABLE_HITO_2';
GO
