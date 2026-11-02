SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.Docente', 'U') IS NULL OR OBJECT_ID('vcm.DocenteSeccion', 'U') IS NULL
  THROW 50005, 'No existe el modelo académico docente. Ejecuta primero la migración 002.', 1;
GO

;WITH accountMatches AS (
  SELECT teacher.docente_id, usr.usuario_id,
    COUNT(*) OVER (PARTITION BY usr.usuario_id) AS teacher_matches
  FROM vcm.Docente teacher
  INNER JOIN vcm.Usuario usr
    ON LOWER(usr.correo) = LOWER(teacher.correo)
    AND usr.activo = 1
    AND usr.rol IN ('TEACHER', 'COORDINATOR')
  WHERE teacher.usuario_id IS NULL
    AND teacher.correo IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM vcm.Docente linked_teacher
      WHERE linked_teacher.usuario_id = usr.usuario_id
    )
)
UPDATE teacher
SET usuario_id = match.usuario_id,
    actualizado_en = SYSUTCDATETIME()
FROM vcm.Docente teacher
INNER JOIN accountMatches match ON match.docente_id = teacher.docente_id
WHERE match.teacher_matches = 1;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.stats
  WHERE name = 'IX_Docente_CorreoVinculacion'
    AND object_id = OBJECT_ID('vcm.Docente')
)
  CREATE INDEX IX_Docente_CorreoVinculacion
    ON vcm.Docente(correo, activo)
    INCLUDE (usuario_id);
GO
