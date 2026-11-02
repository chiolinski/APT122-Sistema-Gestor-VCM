SET XACT_ABORT ON;
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('vcm.Proyecto')
    AND name = 'fecha_inicio'
    AND is_nullable = 0
)
  ALTER TABLE vcm.Proyecto ALTER COLUMN fecha_inicio date NULL;
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('vcm.Proyecto')
    AND name = 'fecha_termino'
    AND is_nullable = 0
)
  ALTER TABLE vcm.Proyecto ALTER COLUMN fecha_termino date NULL;
GO

INSERT INTO vcm.ProyectoSeccion (proyecto_id, seccion_id)
SELECT project.proyecto_id, section.seccion_id
FROM vcm.Proyecto project
INNER JOIN vcm.ProyectoSede projectCampus ON projectCampus.proyecto_id = project.proyecto_id
INNER JOIN vcm.Seccion section ON section.asignatura_id = project.asignatura_id
  AND section.sede_id = projectCampus.sede_id
  AND section.activa = 1
WHERE section.periodo_academico_id = (
    SELECT TOP (1) period.periodo_academico_id
    FROM vcm.CargaAcademica academicLoad
    INNER JOIN vcm.PeriodoAcademico period ON period.codigo = academicLoad.periodo
    WHERE academicLoad.estado = 'APLICADA'
    ORDER BY academicLoad.aplicado_en DESC, academicLoad.creado_en DESC
  )
  AND NOT EXISTS (
    SELECT 1 FROM vcm.ProyectoSeccion existing
    WHERE existing.proyecto_id = project.proyecto_id
      AND existing.seccion_id = section.seccion_id
  );
GO
