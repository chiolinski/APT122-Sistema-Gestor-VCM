SET XACT_ABORT ON;
GO

IF OBJECT_ID('vcm.RevisionSocio', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.RevisionSocio (
    revision_socio_id uniqueidentifier NOT NULL CONSTRAINT PK_RevisionSocio PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    socio_formador_id uniqueidentifier NOT NULL,
    token_hash char(64) NOT NULL CONSTRAINT UQ_RevisionSocio_Token UNIQUE,
    equipos_json nvarchar(max) NOT NULL,
    creado_por_usuario_id uniqueidentifier NOT NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_RevisionSocio_Creado DEFAULT SYSUTCDATETIME(),
    vence_en datetime2(0) NOT NULL,
    revocado_en datetime2(0) NULL,
    completado_en datetime2(0) NULL,
    CONSTRAINT FK_RevisionSocio_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_RevisionSocio_Seccion FOREIGN KEY (seccion_id) REFERENCES vcm.Seccion(seccion_id),
    CONSTRAINT FK_RevisionSocio_Socio FOREIGN KEY (socio_formador_id) REFERENCES vcm.SocioFormador(socio_formador_id),
    CONSTRAINT FK_RevisionSocio_Usuario FOREIGN KEY (creado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_RevisionSocio_Equipos CHECK (ISJSON(equipos_json) = 1)
  );
  CREATE INDEX IX_RevisionSocio_ProyectoSeccion ON vcm.RevisionSocio(proyecto_id, seccion_id, creado_en DESC);
END;
GO

IF OBJECT_ID('vcm.EvaluacionSocioEquipo', 'U') IS NULL
BEGIN
  -- La identidad del equipo referencia la publicación en equipos_json, no la nómina
  -- mutable de Equipo. Así las revisiones conservan su contexto al reorganizar equipos.
  CREATE TABLE vcm.EvaluacionSocioEquipo (
    revision_socio_id uniqueidentifier NOT NULL,
    equipo_id uniqueidentifier NOT NULL,
    fortalezas nvarchar(4000) NOT NULL,
    mejoras nvarchar(4000) NOT NULL,
    valoracion tinyint NOT NULL,
    revisado_en datetime2(0) NOT NULL CONSTRAINT DF_EvaluacionSocioEquipo_Fecha DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_EvaluacionSocioEquipo PRIMARY KEY (revision_socio_id, equipo_id),
    CONSTRAINT FK_EvaluacionSocioEquipo_Revision FOREIGN KEY (revision_socio_id) REFERENCES vcm.RevisionSocio(revision_socio_id) ON DELETE CASCADE,
    CONSTRAINT CK_EvaluacionSocioEquipo_Valoracion CHECK (valoracion BETWEEN 1 AND 5),
    CONSTRAINT CK_EvaluacionSocioEquipo_Textos CHECK (LEN(LTRIM(RTRIM(fortalezas))) > 0 AND LEN(LTRIM(RTRIM(mejoras))) > 0)
  );
END;
GO
