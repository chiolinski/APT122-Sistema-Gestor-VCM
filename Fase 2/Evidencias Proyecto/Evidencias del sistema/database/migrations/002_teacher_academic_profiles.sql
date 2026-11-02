SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.Docente', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Docente (
    docente_id uniqueidentifier NOT NULL CONSTRAINT PK_Docente PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    identificador_fuente nvarchar(200) NOT NULL CONSTRAINT UQ_Docente_IdentificadorFuente UNIQUE,
    nombre nvarchar(180) NOT NULL,
    correo nvarchar(320) NULL,
    usuario_id uniqueidentifier NULL,
    activo bit NOT NULL CONSTRAINT DF_Docente_Activo DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Docente_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Docente_Actualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Docente_Usuario FOREIGN KEY (usuario_id) REFERENCES vcm.Usuario(usuario_id)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_Docente_Usuario' AND object_id = OBJECT_ID('vcm.Docente')
)
  CREATE UNIQUE INDEX UX_Docente_Usuario ON vcm.Docente(usuario_id) WHERE usuario_id IS NOT NULL;
GO

MERGE vcm.Docente WITH (HOLDLOCK) AS target
USING (
  SELECT COALESCE(NULLIF(identidad_externa_id, N''), correo) AS identificador_fuente,
         nombre, correo, usuario_id
  FROM vcm.Usuario
  WHERE rol = 'TEACHER'
) AS source
ON target.identificador_fuente = source.identificador_fuente
WHEN MATCHED THEN
  UPDATE SET nombre = source.nombre, correo = source.correo, usuario_id = source.usuario_id,
             activo = 1, actualizado_en = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (identificador_fuente, nombre, correo, usuario_id)
  VALUES (source.identificador_fuente, source.nombre, source.correo, source.usuario_id);
GO

IF COL_LENGTH('vcm.DocenteSeccion', 'docente_id') IS NULL
  ALTER TABLE vcm.DocenteSeccion ADD docente_id uniqueidentifier NULL;
GO

IF COL_LENGTH('vcm.DocenteSeccion', 'usuario_id') IS NOT NULL
BEGIN
  UPDATE assignment
  SET docente_id = teacher.docente_id
  FROM vcm.DocenteSeccion assignment
  INNER JOIN vcm.Docente teacher ON teacher.usuario_id = assignment.usuario_id
  WHERE assignment.docente_id IS NULL;

  IF EXISTS (SELECT 1 FROM vcm.DocenteSeccion WHERE docente_id IS NULL)
    THROW 50001, 'No fue posible vincular todas las asignaciones docentes existentes.', 1;

  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_DocenteSeccion_Usuario' AND object_id = OBJECT_ID('vcm.DocenteSeccion')
  )
    DROP INDEX IX_DocenteSeccion_Usuario ON vcm.DocenteSeccion;

  IF EXISTS (
    SELECT 1 FROM sys.key_constraints
    WHERE name = 'PK_DocenteSeccion' AND parent_object_id = OBJECT_ID('vcm.DocenteSeccion')
  )
    ALTER TABLE vcm.DocenteSeccion DROP CONSTRAINT PK_DocenteSeccion;

  IF EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_DocenteSeccion_Usuario' AND parent_object_id = OBJECT_ID('vcm.DocenteSeccion')
  )
    ALTER TABLE vcm.DocenteSeccion DROP CONSTRAINT FK_DocenteSeccion_Usuario;

  ALTER TABLE vcm.DocenteSeccion DROP COLUMN usuario_id;
END;
GO

ALTER TABLE vcm.DocenteSeccion ALTER COLUMN docente_id uniqueidentifier NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'PK_DocenteSeccion' AND parent_object_id = OBJECT_ID('vcm.DocenteSeccion')
)
  ALTER TABLE vcm.DocenteSeccion
    ADD CONSTRAINT PK_DocenteSeccion PRIMARY KEY (docente_id, seccion_id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_DocenteSeccion_Docente' AND parent_object_id = OBJECT_ID('vcm.DocenteSeccion')
)
  ALTER TABLE vcm.DocenteSeccion
    ADD CONSTRAINT FK_DocenteSeccion_Docente FOREIGN KEY (docente_id) REFERENCES vcm.Docente(docente_id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_DocenteSeccion_Docente' AND object_id = OBJECT_ID('vcm.DocenteSeccion')
)
  CREATE INDEX IX_DocenteSeccion_Docente ON vcm.DocenteSeccion(docente_id, vigente);
GO
