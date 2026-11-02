SET XACT_ABORT ON;
GO

IF COL_LENGTH('vcm.HitoProyecto', 'disponible_desde') IS NULL
  ALTER TABLE vcm.HitoProyecto ADD disponible_desde date NULL;
GO

IF COL_LENGTH('vcm.HitoProyecto', 'habilitado_en') IS NULL
  ALTER TABLE vcm.HitoProyecto ADD habilitado_en datetime2(0) NULL;
GO

IF COL_LENGTH('vcm.HitoProyecto', 'habilitado_por_usuario_id') IS NULL
  ALTER TABLE vcm.HitoProyecto ADD habilitado_por_usuario_id uniqueidentifier NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_HitoProyecto_HabilitadoPorUsuario'
    AND parent_object_id = OBJECT_ID('vcm.HitoProyecto')
)
BEGIN
  EXEC(N'
    ALTER TABLE vcm.HitoProyecto WITH CHECK
      ADD CONSTRAINT FK_HitoProyecto_HabilitadoPorUsuario
      FOREIGN KEY (habilitado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id);
  ');
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_HitoProyecto_Disponibilidad'
    AND parent_object_id = OBJECT_ID('vcm.HitoProyecto')
)
BEGIN
  EXEC(N'
    ALTER TABLE vcm.HitoProyecto WITH CHECK
      ADD CONSTRAINT CK_HitoProyecto_Disponibilidad
      CHECK (
        numero = 2
        OR (disponible_desde IS NULL AND habilitado_en IS NULL AND habilitado_por_usuario_id IS NULL)
      );
  ');
END;
GO

-- Mantiene disponibles los proyectos que ya habían completado globalmente el Hito 1
-- antes de incorporar el calendario de apertura.
EXEC(N'
  UPDATE milestoneTwo
  SET disponible_desde = COALESCE(milestoneTwo.disponible_desde, CONVERT(date, milestoneOne.completado_en),
      CONVERT(date, SYSUTCDATETIME())),
    habilitado_en = COALESCE(milestoneTwo.habilitado_en, SYSUTCDATETIME()),
    habilitado_por_usuario_id = COALESCE(milestoneTwo.habilitado_por_usuario_id, milestoneOne.completado_por_usuario_id)
  FROM vcm.HitoProyecto milestoneTwo
  INNER JOIN vcm.HitoProyecto milestoneOne
    ON milestoneOne.proyecto_id = milestoneTwo.proyecto_id
    AND milestoneOne.numero = 1
    AND milestoneOne.estado = ''COMPLETADO''
  WHERE milestoneTwo.numero = 2
    AND milestoneTwo.disponible_desde IS NULL;
');
GO
