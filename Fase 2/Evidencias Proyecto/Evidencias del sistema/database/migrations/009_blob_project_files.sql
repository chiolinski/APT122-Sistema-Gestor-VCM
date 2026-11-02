SET XACT_ABORT ON;
GO

IF COL_LENGTH('vcm.ArchivoProyecto', 'seccion_id') IS NULL
  ALTER TABLE vcm.ArchivoProyecto ADD seccion_id uniqueidentifier NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_ArchivoProyecto_Seccion'
    AND parent_object_id = OBJECT_ID('vcm.ArchivoProyecto')
)
BEGIN
  ALTER TABLE vcm.ArchivoProyecto WITH CHECK
    ADD CONSTRAINT FK_ArchivoProyecto_Seccion
    FOREIGN KEY (seccion_id) REFERENCES vcm.Seccion(seccion_id);
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ArchivoProyecto_ProyectoCategoriaSeccion'
    AND object_id = OBJECT_ID('vcm.ArchivoProyecto')
)
  CREATE UNIQUE INDEX IX_ArchivoProyecto_ProyectoCategoriaSeccion
    ON vcm.ArchivoProyecto(proyecto_id, categoria, seccion_id);
GO
