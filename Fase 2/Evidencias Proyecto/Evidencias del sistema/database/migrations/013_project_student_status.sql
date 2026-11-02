SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.ProyectoAlumnoEstado', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.ProyectoAlumnoEstado (
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    alumno_id uniqueidentifier NOT NULL,
    estado varchar(20) NOT NULL CONSTRAINT DF_ProyectoAlumnoEstado_Estado DEFAULT 'SIN_EQUIPO',
    actualizado_por_usuario_id uniqueidentifier NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_ProyectoAlumnoEstado_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_ProyectoAlumnoEstado_Actualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_ProyectoAlumnoEstado PRIMARY KEY (proyecto_id, alumno_id),
    CONSTRAINT FK_ProyectoAlumnoEstado_ProyectoSeccion FOREIGN KEY (proyecto_id, seccion_id)
      REFERENCES vcm.ProyectoSeccion(proyecto_id, seccion_id) ON DELETE CASCADE,
    CONSTRAINT FK_ProyectoAlumnoEstado_Alumno FOREIGN KEY (alumno_id)
      REFERENCES vcm.Alumno(alumno_id),
    CONSTRAINT FK_ProyectoAlumnoEstado_Usuario FOREIGN KEY (actualizado_por_usuario_id)
      REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_ProyectoAlumnoEstado_Estado CHECK (estado IN ('ASIGNADO', 'SIN_EQUIPO', 'DESERTOR'))
  );
END;
GO

INSERT INTO vcm.ProyectoAlumnoEstado (proyecto_id, seccion_id, alumno_id, estado)
SELECT projectSection.proyecto_id, projectSection.seccion_id, enrollment.alumno_id,
  CASE WHEN EXISTS (
    SELECT 1 FROM vcm.EquipoAlumno membership
    INNER JOIN vcm.Equipo team ON team.equipo_id = membership.equipo_id
    WHERE membership.proyecto_id = projectSection.proyecto_id
      AND membership.alumno_id = enrollment.alumno_id
      AND team.seccion_id = projectSection.seccion_id
  ) THEN 'ASIGNADO' ELSE 'SIN_EQUIPO' END
FROM vcm.ProyectoSeccion projectSection
INNER JOIN vcm.Proyecto project ON project.proyecto_id = projectSection.proyecto_id
INNER JOIN vcm.Matricula enrollment
  ON enrollment.seccion_id = projectSection.seccion_id
  AND enrollment.asignatura_id = project.asignatura_id
  AND enrollment.vigente = 1
INNER JOIN vcm.Alumno student ON student.alumno_id = enrollment.alumno_id AND student.activo = 1
WHERE NOT EXISTS (
  SELECT 1 FROM vcm.ProyectoAlumnoEstado studentStatus
  WHERE studentStatus.proyecto_id = projectSection.proyecto_id
    AND studentStatus.alumno_id = enrollment.alumno_id
);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_ProyectoAlumnoEstado_SeccionEstado'
    AND object_id = OBJECT_ID('vcm.ProyectoAlumnoEstado')
)
  CREATE INDEX IX_ProyectoAlumnoEstado_SeccionEstado
    ON vcm.ProyectoAlumnoEstado(proyecto_id, seccion_id, estado);
GO
