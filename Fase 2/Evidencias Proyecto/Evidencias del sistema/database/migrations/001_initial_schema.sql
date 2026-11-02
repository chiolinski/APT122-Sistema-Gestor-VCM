SET XACT_ABORT ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'vcm')
  EXEC('CREATE SCHEMA vcm');
GO

IF OBJECT_ID('vcm.Migracion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Migracion (
    migracion_id int IDENTITY(1,1) NOT NULL CONSTRAINT PK_Migracion PRIMARY KEY,
    archivo nvarchar(260) NOT NULL CONSTRAINT UQ_Migracion_Archivo UNIQUE,
    hash_sha256 char(64) NOT NULL,
    aplicada_en datetime2(0) NOT NULL CONSTRAINT DF_Migracion_Fecha DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('vcm.Sede', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Sede (
    sede_id uniqueidentifier NOT NULL CONSTRAINT PK_Sede PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    codigo varchar(40) NOT NULL CONSTRAINT UQ_Sede_Codigo UNIQUE,
    nombre nvarchar(120) NOT NULL,
    activa bit NOT NULL CONSTRAINT DF_Sede_Activa DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Sede_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Sede_Actualizado DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('vcm.Asignatura', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Asignatura (
    asignatura_id uniqueidentifier NOT NULL CONSTRAINT PK_Asignatura PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    codigo varchar(40) NOT NULL CONSTRAINT UQ_Asignatura_Codigo UNIQUE,
    nombre nvarchar(180) NOT NULL,
    activa bit NOT NULL CONSTRAINT DF_Asignatura_Activa DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Asignatura_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Asignatura_Actualizado DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('vcm.PeriodoAcademico', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.PeriodoAcademico (
    periodo_academico_id uniqueidentifier NOT NULL CONSTRAINT PK_PeriodoAcademico PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    codigo varchar(20) NOT NULL CONSTRAINT UQ_PeriodoAcademico_Codigo UNIQUE,
    nombre nvarchar(100) NOT NULL,
    fecha_inicio date NULL,
    fecha_termino date NULL,
    activo bit NOT NULL CONSTRAINT DF_PeriodoAcademico_Activo DEFAULT 1,
    CONSTRAINT CK_PeriodoAcademico_Fechas CHECK (fecha_inicio IS NULL OR fecha_termino IS NULL OR fecha_termino >= fecha_inicio)
  );
END;
GO

IF OBJECT_ID('vcm.Usuario', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Usuario (
    usuario_id uniqueidentifier NOT NULL CONSTRAINT PK_Usuario PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    identidad_externa_id nvarchar(200) NULL CONSTRAINT UQ_Usuario_Identidad UNIQUE,
    correo nvarchar(320) NOT NULL CONSTRAINT UQ_Usuario_Correo UNIQUE,
    nombre nvarchar(180) NOT NULL,
    rol varchar(20) NOT NULL,
    cargo_visual nvarchar(100) NOT NULL,
    activo bit NOT NULL CONSTRAINT DF_Usuario_Activo DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Usuario_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Usuario_Actualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_Usuario_Rol CHECK (rol IN ('ADMIN', 'COORDINATOR', 'TEACHER')),
    CONSTRAINT CK_Usuario_CargoCoordinador CHECK (
      rol <> 'COORDINATOR' OR cargo_visual IN (N'Coordinador CITT', N'Director de Carrera')
    )
  );
END;
GO

IF OBJECT_ID('vcm.SocioFormador', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.SocioFormador (
    socio_formador_id uniqueidentifier NOT NULL CONSTRAINT PK_SocioFormador PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    rut varchar(20) NOT NULL CONSTRAINT UQ_SocioFormador_Rut UNIQUE,
    razon_social nvarchar(350) NOT NULL,
    rubro nvarchar(150) NULL,
    contacto_nombre nvarchar(180) NOT NULL,
    contacto_correo nvarchar(320) NOT NULL,
    contacto_telefono nvarchar(40) NULL,
    creado_por_usuario_id uniqueidentifier NULL,
    activo bit NOT NULL CONSTRAINT DF_SocioFormador_Activo DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_SocioFormador_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_SocioFormador_Actualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_SocioFormador_Usuario FOREIGN KEY (creado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id)
  );
END;
GO

IF OBJECT_ID('vcm.CargaAcademica', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.CargaAcademica (
    carga_academica_id uniqueidentifier NOT NULL CONSTRAINT PK_CargaAcademica PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    nombre_archivo nvarchar(260) NOT NULL,
    hash_sha256 char(64) NOT NULL,
    periodo varchar(20) NOT NULL,
    estado varchar(20) NOT NULL CONSTRAINT DF_CargaAcademica_Estado DEFAULT 'PROCESANDO',
    aplicado_por nvarchar(320) NOT NULL,
    total_sedes int NOT NULL CONSTRAINT DF_CargaAcademica_Sedes DEFAULT 0,
    total_asignaturas int NOT NULL CONSTRAINT DF_CargaAcademica_Asignaturas DEFAULT 0,
    total_secciones int NOT NULL CONSTRAINT DF_CargaAcademica_Secciones DEFAULT 0,
    total_docentes int NOT NULL CONSTRAINT DF_CargaAcademica_Docentes DEFAULT 0,
    total_alumnos int NOT NULL CONSTRAINT DF_CargaAcademica_Alumnos DEFAULT 0,
    total_advertencias int NOT NULL CONSTRAINT DF_CargaAcademica_Advertencias DEFAULT 0,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_CargaAcademica_Creado DEFAULT SYSUTCDATETIME(),
    aplicado_en datetime2(0) NULL,
    CONSTRAINT CK_CargaAcademica_Estado CHECK (estado IN ('PROCESANDO', 'APLICADA', 'ERROR')),
    CONSTRAINT UQ_CargaAcademica_Hash UNIQUE (hash_sha256)
  );
END;
GO

IF OBJECT_ID('vcm.Seccion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Seccion (
    seccion_id uniqueidentifier NOT NULL CONSTRAINT PK_Seccion PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    asignatura_id uniqueidentifier NOT NULL,
    sede_id uniqueidentifier NOT NULL,
    periodo_academico_id uniqueidentifier NOT NULL,
    codigo nvarchar(40) NOT NULL,
    jornada nvarchar(40) NULL,
    carga_academica_id uniqueidentifier NULL,
    activa bit NOT NULL CONSTRAINT DF_Seccion_Activa DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Seccion_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Seccion_Actualizado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Seccion_Asignatura FOREIGN KEY (asignatura_id) REFERENCES vcm.Asignatura(asignatura_id),
    CONSTRAINT FK_Seccion_Sede FOREIGN KEY (sede_id) REFERENCES vcm.Sede(sede_id),
    CONSTRAINT FK_Seccion_Periodo FOREIGN KEY (periodo_academico_id) REFERENCES vcm.PeriodoAcademico(periodo_academico_id),
    CONSTRAINT FK_Seccion_Carga FOREIGN KEY (carga_academica_id) REFERENCES vcm.CargaAcademica(carga_academica_id),
    CONSTRAINT UQ_Seccion_Natural UNIQUE (asignatura_id, sede_id, periodo_academico_id, codigo),
    CONSTRAINT UQ_Seccion_IdAsignatura UNIQUE (seccion_id, asignatura_id)
  );
END;
GO

IF OBJECT_ID('vcm.DocenteSeccion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.DocenteSeccion (
    usuario_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    carga_academica_id uniqueidentifier NULL,
    vigente bit NOT NULL CONSTRAINT DF_DocenteSeccion_Vigente DEFAULT 1,
    asignado_en datetime2(0) NOT NULL CONSTRAINT DF_DocenteSeccion_Asignado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_DocenteSeccion PRIMARY KEY (usuario_id, seccion_id),
    CONSTRAINT FK_DocenteSeccion_Usuario FOREIGN KEY (usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT FK_DocenteSeccion_Seccion FOREIGN KEY (seccion_id) REFERENCES vcm.Seccion(seccion_id),
    CONSTRAINT FK_DocenteSeccion_Carga FOREIGN KEY (carga_academica_id) REFERENCES vcm.CargaAcademica(carga_academica_id)
  );
END;
GO

IF OBJECT_ID('vcm.Alumno', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Alumno (
    alumno_id uniqueidentifier NOT NULL CONSTRAINT PK_Alumno PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    identificador_externo nvarchar(80) NULL CONSTRAINT UQ_Alumno_Identificador UNIQUE,
    rut varchar(20) NOT NULL CONSTRAINT UQ_Alumno_Rut UNIQUE,
    nombre_completo nvarchar(180) NOT NULL,
    correo nvarchar(320) NULL,
    activo bit NOT NULL CONSTRAINT DF_Alumno_Activo DEFAULT 1,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Alumno_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Alumno_Actualizado DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF OBJECT_ID('vcm.Matricula', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Matricula (
    matricula_id uniqueidentifier NOT NULL CONSTRAINT PK_Matricula PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    alumno_id uniqueidentifier NOT NULL,
    asignatura_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    carga_academica_id uniqueidentifier NULL,
    vigente bit NOT NULL CONSTRAINT DF_Matricula_Vigente DEFAULT 1,
    matriculado_en datetime2(0) NOT NULL CONSTRAINT DF_Matricula_Fecha DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Matricula_Alumno FOREIGN KEY (alumno_id) REFERENCES vcm.Alumno(alumno_id),
    CONSTRAINT FK_Matricula_SeccionAsignatura FOREIGN KEY (seccion_id, asignatura_id) REFERENCES vcm.Seccion(seccion_id, asignatura_id),
    CONSTRAINT FK_Matricula_Carga FOREIGN KEY (carga_academica_id) REFERENCES vcm.CargaAcademica(carga_academica_id),
    CONSTRAINT UQ_Matricula_AlumnoAsignatura UNIQUE (alumno_id, asignatura_id),
    CONSTRAINT UQ_Matricula_AlumnoSeccion UNIQUE (alumno_id, seccion_id)
  );
END;
GO

IF OBJECT_ID('vcm.Proyecto', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Proyecto (
    proyecto_id uniqueidentifier NOT NULL CONSTRAINT PK_Proyecto PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    codigo_publico varchar(30) NOT NULL CONSTRAINT UQ_Proyecto_Codigo UNIQUE,
    nombre nvarchar(220) NOT NULL,
    socio_formador_id uniqueidentifier NOT NULL,
    asignatura_id uniqueidentifier NOT NULL,
    descripcion nvarchar(max) NOT NULL,
    resultado_esperado nvarchar(max) NOT NULL,
    fecha_inicio date NOT NULL,
    fecha_termino date NOT NULL,
    estado varchar(20) NOT NULL CONSTRAINT DF_Proyecto_Estado DEFAULT 'PLANIFICADO',
    creado_por_usuario_id uniqueidentifier NOT NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Proyecto_Creado DEFAULT SYSUTCDATETIME(),
    actualizado_en datetime2(0) NOT NULL CONSTRAINT DF_Proyecto_Actualizado DEFAULT SYSUTCDATETIME(),
    cerrado_en datetime2(0) NULL,
    CONSTRAINT FK_Proyecto_Socio FOREIGN KEY (socio_formador_id) REFERENCES vcm.SocioFormador(socio_formador_id),
    CONSTRAINT FK_Proyecto_Asignatura FOREIGN KEY (asignatura_id) REFERENCES vcm.Asignatura(asignatura_id),
    CONSTRAINT FK_Proyecto_Usuario FOREIGN KEY (creado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_Proyecto_Estado CHECK (estado IN ('PLANIFICADO', 'EN_EJECUCION', 'FINALIZADO', 'CANCELADO')),
    CONSTRAINT CK_Proyecto_Fechas CHECK (fecha_termino >= fecha_inicio)
  );
END;
GO

IF OBJECT_ID('vcm.ProyectoSede', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.ProyectoSede (
    proyecto_id uniqueidentifier NOT NULL,
    sede_id uniqueidentifier NOT NULL,
    CONSTRAINT PK_ProyectoSede PRIMARY KEY (proyecto_id, sede_id),
    CONSTRAINT FK_ProyectoSede_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_ProyectoSede_Sede FOREIGN KEY (sede_id) REFERENCES vcm.Sede(sede_id)
  );
END;
GO

IF OBJECT_ID('vcm.ProyectoSeccion', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.ProyectoSeccion (
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    CONSTRAINT PK_ProyectoSeccion PRIMARY KEY (proyecto_id, seccion_id),
    CONSTRAINT FK_ProyectoSeccion_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_ProyectoSeccion_Seccion FOREIGN KEY (seccion_id) REFERENCES vcm.Seccion(seccion_id)
  );
END;
GO

IF OBJECT_ID('vcm.ArchivoProyecto', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.ArchivoProyecto (
    archivo_proyecto_id uniqueidentifier NOT NULL CONSTRAINT PK_ArchivoProyecto PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    categoria varchar(30) NOT NULL,
    nombre_original nvarchar(260) NOT NULL,
    clave_almacenamiento nvarchar(500) NOT NULL CONSTRAINT UQ_ArchivoProyecto_Clave UNIQUE,
    tipo_contenido nvarchar(150) NULL,
    tamano_bytes bigint NULL,
    subido_por_usuario_id uniqueidentifier NOT NULL,
    subido_en datetime2(0) NOT NULL CONSTRAINT DF_ArchivoProyecto_Subido DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ArchivoProyecto_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_ArchivoProyecto_Usuario FOREIGN KEY (subido_por_usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT CK_ArchivoProyecto_Categoria CHECK (categoria IN ('ANTECEDENTE', 'ENTREGABLE_HITO_2')),
    CONSTRAINT CK_ArchivoProyecto_Tamano CHECK (tamano_bytes IS NULL OR tamano_bytes >= 0)
  );
END;
GO

IF OBJECT_ID('vcm.Equipo', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.Equipo (
    equipo_id uniqueidentifier NOT NULL CONSTRAINT PK_Equipo PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    seccion_id uniqueidentifier NOT NULL,
    nombre nvarchar(100) NOT NULL,
    creado_por_usuario_id uniqueidentifier NOT NULL,
    creado_en datetime2(0) NOT NULL CONSTRAINT DF_Equipo_Creado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Equipo_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_Equipo_Seccion FOREIGN KEY (seccion_id) REFERENCES vcm.Seccion(seccion_id),
    CONSTRAINT FK_Equipo_Usuario FOREIGN KEY (creado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT UQ_Equipo_ProyectoSeccionNombre UNIQUE (proyecto_id, seccion_id, nombre)
  );
END;
GO

IF OBJECT_ID('vcm.EquipoAlumno', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.EquipoAlumno (
    equipo_id uniqueidentifier NOT NULL,
    alumno_id uniqueidentifier NOT NULL,
    proyecto_id uniqueidentifier NOT NULL,
    incorporado_en datetime2(0) NOT NULL CONSTRAINT DF_EquipoAlumno_Fecha DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_EquipoAlumno PRIMARY KEY (equipo_id, alumno_id),
    CONSTRAINT FK_EquipoAlumno_Equipo FOREIGN KEY (equipo_id) REFERENCES vcm.Equipo(equipo_id) ON DELETE CASCADE,
    CONSTRAINT FK_EquipoAlumno_Alumno FOREIGN KEY (alumno_id) REFERENCES vcm.Alumno(alumno_id),
    CONSTRAINT FK_EquipoAlumno_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id),
    CONSTRAINT UQ_EquipoAlumno_ProyectoAlumno UNIQUE (proyecto_id, alumno_id)
  );
END;
GO

IF OBJECT_ID('vcm.HitoProyecto', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.HitoProyecto (
    hito_proyecto_id uniqueidentifier NOT NULL CONSTRAINT PK_HitoProyecto PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL,
    numero tinyint NOT NULL,
    estado varchar(15) NOT NULL CONSTRAINT DF_HitoProyecto_Estado DEFAULT 'PENDIENTE',
    completado_en datetime2(0) NULL,
    completado_por_usuario_id uniqueidentifier NULL,
    CONSTRAINT FK_HitoProyecto_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_HitoProyecto_Usuario FOREIGN KEY (completado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id),
    CONSTRAINT UQ_HitoProyecto_Numero UNIQUE (proyecto_id, numero),
    CONSTRAINT CK_HitoProyecto_Numero CHECK (numero BETWEEN 1 AND 3),
    CONSTRAINT CK_HitoProyecto_Estado CHECK (estado IN ('PENDIENTE', 'COMPLETADO'))
  );
END;
GO

IF OBJECT_ID('vcm.AvanceProyecto', 'U') IS NULL
BEGIN
  CREATE TABLE vcm.AvanceProyecto (
    avance_proyecto_id uniqueidentifier NOT NULL CONSTRAINT PK_AvanceProyecto PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
    proyecto_id uniqueidentifier NOT NULL CONSTRAINT UQ_AvanceProyecto_Proyecto UNIQUE,
    avance_resultado nvarchar(max) NOT NULL,
    conclusiones nvarchar(max) NOT NULL,
    registrado_por_usuario_id uniqueidentifier NOT NULL,
    registrado_en datetime2(0) NOT NULL CONSTRAINT DF_AvanceProyecto_Registrado DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AvanceProyecto_Proyecto FOREIGN KEY (proyecto_id) REFERENCES vcm.Proyecto(proyecto_id) ON DELETE CASCADE,
    CONSTRAINT FK_AvanceProyecto_Usuario FOREIGN KEY (registrado_por_usuario_id) REFERENCES vcm.Usuario(usuario_id)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Seccion_Asignatura' AND object_id = OBJECT_ID('vcm.Seccion'))
  CREATE INDEX IX_Seccion_Asignatura ON vcm.Seccion(asignatura_id, activa);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Seccion_Sede' AND object_id = OBJECT_ID('vcm.Seccion'))
  CREATE INDEX IX_Seccion_Sede ON vcm.Seccion(sede_id, activa);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DocenteSeccion_Usuario' AND object_id = OBJECT_ID('vcm.DocenteSeccion'))
  CREATE INDEX IX_DocenteSeccion_Usuario ON vcm.DocenteSeccion(usuario_id, vigente);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Proyecto_Estado' AND object_id = OBJECT_ID('vcm.Proyecto'))
  CREATE INDEX IX_Proyecto_Estado ON vcm.Proyecto(estado, asignatura_id);
GO
