SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.Escuela', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Escuela (
    escuela_id uniqueidentifier NOT NULL CONSTRAINT PK_Escuela PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    nombre nvarchar(180) NOT NULL CONSTRAINT UQ_Escuela_Nombre UNIQUE,
    activa bit NOT NULL CONSTRAINT DF_Escuela_Activa DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Escuela_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Escuela_Actualizado DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF COL_LENGTH('vcm.Asignatura', 'escuela_id') IS NULL
  ALTER TABLE vcm.Asignatura ADD escuela_id uniqueidentifier NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_Asignatura_Escuela' AND parent_object_id = OBJECT_ID('vcm.Asignatura')
)
  ALTER TABLE vcm.Asignatura
    ADD CONSTRAINT FK_Asignatura_Escuela FOREIGN KEY (escuela_id) REFERENCES vcm.Escuela(escuela_id);
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_Asignatura_Escuela' AND object_id = OBJECT_ID('vcm.Asignatura')
)
  CREATE INDEX IX_Asignatura_Escuela ON vcm.Asignatura(escuela_id, activa);
GO

IF COL_LENGTH('vcm.CargaAcademica', 'total_escuelas') IS NULL
  ALTER TABLE vcm.CargaAcademica
    ADD total_escuelas int NOT NULL CONSTRAINT DF_CargaAcademica_Escuelas DEFAULT 0;
GO

MERGE vcm.Escuela WITH (HOLDLOCK) AS target
USING (SELECT N'Informática y Telecomunicaciones' AS nombre) AS source
  ON LOWER(target.nombre) = LOWER(source.nombre)
WHEN MATCHED THEN
  UPDATE SET activa = 1, actualizado_en = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (nombre) VALUES (source.nombre);
GO

UPDATE subject
SET escuela_id = school.escuela_id, actualizado_en = SYSUTCDATETIME()
FROM vcm.Asignatura subject
INNER JOIN vcm.Escuela school ON school.nombre = N'Informática y Telecomunicaciones'
WHERE subject.codigo IN ('ARY1102', 'DSY1105', 'SIY6122');
GO
