SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.HitoProyectoSeccion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.HitoProyectoSeccion (
    hito_proyecto_seccion_id uniqueidentifier NOT NULL CONSTRAINT PK_HitoProyectoSeccion PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    numero tinyint NOT NULL,
    estado varchar(15) NOT NULL CONSTRAINT DF_HitoProyectoSeccion_Estado DEFAULT 'PENDIENTE',
    completado_en datetime2(0) NULL,
    completado_por_usuario_id uniqueidentifier NULL,
    CONSTRAINT FK_HitoProyectoSeccion_ProyectoSeccion FOREIGN KEY (proyecto_id, seccion_id)
      REFERENCES vcm.ProyectoSeccion(proyecto_id, seccion_id) ON DELETE CASCADE,
    CONSTRAINT FK_HitoProyectoSeccion_Usuario FOREIGN KEY (completado_por_usuario_id)
      REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT UQ_HitoProyectoSeccion_Numero UNIQUE (proyecto_id, seccion_id, numero),
    CONSTRAINT CK_HitoProyectoSeccion_Numero CHECK (numero BETWEEN 1 AND 3),
    CONSTRAINT CK_HitoProyectoSeccion_Estado CHECK (estado IN ('PENDIENTE', 'COMPLETADO'))
  );
END;
GO

IF OBJECT_ID('vcm.AvanceProyectoSeccion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.AvanceProyectoSeccion (
    avance_proyecto_seccion_id uniqueidentifier NOT NULL CONSTRAINT PK_AvanceProyectoSeccion PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    avance_resultado nvarchar(max) NOT NULL,
    conclusiones nvarchar(max) NOT NULL,
    registrado_por_usuario_id uniqueidentifier NOT NULL,
    registrado_en datetime2(0) NOT NULL CONSTRAINT DF_AvanceProyectoSeccion_Registrado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AvanceProyectoSeccion_ProyectoSeccion FOREIGN KEY (proyecto_id, seccion_id)
      REFERENCES vcm.ProyectoSeccion(proyecto_id, seccion_id) ON DELETE CASCADE,
    CONSTRAINT FK_AvanceProyectoSeccion_Usuario FOREIGN KEY (registrado_por_usuario_id)
      REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT UQ_AvanceProyectoSeccion_ProyectoSeccion UNIQUE (proyecto_id, seccion_id)
  );
END;
GO

MERGE vcm.HitoProyectoSeccion WITH (HOLDLOCK) AS target
USING (
  SELECT projectSection.proyecto_id, projectSection.seccion_id, milestone.numero
  FROM vcm.ProyectoSeccion projectSection
  CROSS JOIN (VALUES (CAST(1 AS tinyint)), (CAST(2 AS tinyint)), (CAST(3 AS tinyint))) milestone(numero)
) AS source
  ON target.proyecto_id = source.proyecto_id
  AND target.seccion_id = source.seccion_id
  AND target.numero = source.numero
WHEN NOT MATCHED THEN
  INSERT (proyecto_id, seccion_id, numero)
  VALUES (source.proyecto_id, source.seccion_id, source.numero);
GO

-- Conserva como completados por sección los hitos globales de proyectos anteriores.
UPDATE sectionMilestone
SET estado = 'COMPLETADO',
  completado_en = COALESCE(sectionMilestone.completado_en, projectMilestone.completado_en, SYSUTCDATETIME()),
  completado_por_usuario_id = COALESCE(sectionMilestone.completado_por_usuario_id, projectMilestone.completado_por_usuario_id)
FROM vcm.HitoProyectoSeccion sectionMilestone
INNER JOIN vcm.HitoProyecto projectMilestone
  ON projectMilestone.proyecto_id = sectionMilestone.proyecto_id
  AND projectMilestone.numero = sectionMilestone.numero
WHERE projectMilestone.estado = 'COMPLETADO';
GO

-- Recupera el Hito 1 de cada sección cuya nómina ya está completamente asignada.
;WITH sectionCoverage AS (
  SELECT projectSection.proyecto_id, projectSection.seccion_id,
    COUNT(DISTINCT enrollment.alumno_id) AS total_students,
    COUNT(DISTINCT membership.alumno_id) AS assigned_students,
    MAX(team.creado_en) AS saved_at,
    TRY_CONVERT(uniqueidentifier, MAX(CONVERT(varchar(36), team.creado_por_usuario_id))) AS saved_by
  FROM vcm.ProyectoSeccion projectSection
  INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
  INNER JOIN vcm.Matricula enrollment
    ON enrollment.seccion_id = projectSection.seccion_id
    AND enrollment.asignatura_id = project.asignatura_id
    AND enrollment.vigente = 1
  INNER JOIN vcm.Alumno student
    ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
  LEFT JOIN vcm.Equipo team
    ON team.proyecto_id = projectSection.proyecto_id
    AND team.seccion_id = projectSection.seccion_id
  LEFT JOIN vcm.EquipoAlumno membership
    ON membership.equipo_id = team.equipo_id
    AND membership.proyecto_id = projectSection.proyecto_id
    AND membership.alumno_id = enrollment.alumno_id
  GROUP BY projectSection.proyecto_id, projectSection.seccion_id
)
UPDATE milestone
SET estado = 'COMPLETADO',
  completado_en = COALESCE(milestone.completado_en, coverage.saved_at, SYSUTCDATETIME()),
  completado_por_usuario_id = COALESCE(milestone.completado_por_usuario_id, coverage.saved_by)
FROM vcm.HitoProyectoSeccion milestone
INNER JOIN sectionCoverage coverage
  ON coverage.proyecto_id = milestone.proyecto_id
  AND coverage.seccion_id = milestone.seccion_id
WHERE milestone.numero = 1
  AND coverage.total_students > 0
  AND coverage.total_students = coverage.assigned_students;
GO

-- Copia el avance histórico a las secciones de proyectos que ya completaron el Hito 2.
MERGE vcm.AvanceProyectoSeccion WITH (HOLDLOCK) AS target
USING (
  SELECT projectSection.proyecto_id, projectSection.seccion_id,
    progress.avance_resultado, progress.conclusiones,
    progress.registrado_por_usuario_id, progress.registrado_en
  FROM vcm.ProyectoSeccion projectSection
  INNER JOIN vcm.AvanceProyecto progress ON progress.proyecto_id = projectSection.proyecto_id
  INNER JOIN vcm.HitoProyecto milestone
    ON milestone.proyecto_id = projectSection.proyecto_id
    AND milestone.numero = 2
    AND milestone.estado = 'COMPLETADO'
) AS source
  ON target.proyecto_id = source.proyecto_id AND target.seccion_id = source.seccion_id
WHEN NOT MATCHED THEN
  INSERT (proyecto_id, seccion_id, avance_resultado, conclusiones, registrado_por_usuario_id, registrado_en)
  VALUES (source.proyecto_id, source.seccion_id, source.avance_resultado, source.conclusiones,
    source.registrado_por_usuario_id, source.registrado_en);
GO

-- Los hitos globales siguen siendo el resumen: se completan cuando todas las secciones lo hicieron.
UPDATE projectMilestone
SET estado = 'COMPLETADO',
  completado_en = COALESCE(projectMilestone.completado_en, completed.latest_completion, SYSUTCDATETIME()),
  completado_por_usuario_id = COALESCE(projectMilestone.completado_por_usuario_id, completed.completed_by)
FROM vcm.HitoProyecto projectMilestone
CROSS APPLY (
  SELECT MAX(sectionMilestone.completado_en) AS latest_completion,
    TRY_CONVERT(uniqueidentifier, MAX(CONVERT(varchar(36), sectionMilestone.completado_por_usuario_id))) AS completed_by,
    COUNT(*) AS section_count,
    SUM(CASE WHEN sectionMilestone.estado = 'COMPLETADO' THEN 1 ELSE 0 END) AS completed_count
  FROM vcm.HitoProyectoSeccion sectionMilestone
  WHERE sectionMilestone.proyecto_id = projectMilestone.proyecto_id
    AND sectionMilestone.numero = projectMilestone.numero
) completed
WHERE completed.section_count > 0
  AND completed.section_count = completed.completed_count;
GO

UPDATE project
SET estado = 'EN_EJECUCION', actualizado_en = SYSUTCDATETIME()
FROM vcm.Proyecto project
WHERE project.estado = 'PLANIFICADO'
  AND EXISTS (
    SELECT 1 FROM vcm.HitoProyectoSeccion milestone
    WHERE milestone.proyecto_id = project.proyecto_id
      AND milestone.numero = 1 AND milestone.estado = 'COMPLETADO'
  );
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_HitoProyectoSeccion_ProyectoNumeroEstado'
    AND object_id = OBJECT_ID('vcm.HitoProyectoSeccion')
)
  CREATE INDEX IX_HitoProyectoSeccion_ProyectoNumeroEstado
    ON vcm.HitoProyectoSeccion(proyecto_id, numero, estado);
GO
