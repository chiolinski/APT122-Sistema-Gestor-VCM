const crypto = require("node:crypto");
const { AppError } = require("../lib/http");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");

function jsonRequest(transaction, payload) {
  return new sql.Request(transaction).input("payload", sql.NVarChar(sql.MAX), JSON.stringify(payload));
}

async function applyAcademicImport(parsed, filename, principal) {
  if (!parsed.canApply) throw new AppError(422, "ACADEMIC_IMPORT_HAS_ERRORS", "Corrige los errores antes de confirmar la carga.", parsed.issues);
  const hash = crypto.createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");

  return withTransaction(async (transaction) => {
    const existing = await new sql.Request(transaction)
      .input("hash", sql.Char(64), hash)
      .query("SELECT TOP (1) CONVERT(varchar(36), carga_academica_id) AS id, nombre_archivo AS filename, estado AS status FROM vcm.CargaAcademica WHERE hash_sha256 = @hash;");
    if (existing.recordset[0]) return { ...existing.recordset[0], duplicate: true, summary: parsed.summary };

    const load = await new sql.Request(transaction)
      .input("filename", sql.NVarChar(260), filename.slice(0, 260))
      .input("hash", sql.Char(64), hash)
      .input("period", sql.VarChar(20), parsed.data.period)
      .input("actor", sql.NVarChar(320), principal.email)
      .query(`
        INSERT INTO vcm.CargaAcademica (nombre_archivo, hash_sha256, periodo, aplicado_por)
        OUTPUT CONVERT(varchar(36), inserted.carga_academica_id) AS id
        VALUES (@filename, @hash, @period, @actor);
      `);
    const loadId = load.recordset[0].id;

    await new sql.Request(transaction)
      .input("period", sql.VarChar(20), parsed.data.period)
      .query(`
        MERGE vcm.PeriodoAcademico WITH (HOLDLOCK) AS target
        USING (SELECT @period AS code) AS source ON target.codigo = source.code
        WHEN MATCHED THEN UPDATE SET activo = 1
        WHEN NOT MATCHED THEN INSERT (codigo, nombre) VALUES (source.code, CONCAT('Período ', source.code));
      `);

    await jsonRequest(transaction, parsed.data.campuses).query(`
      MERGE vcm.Sede WITH (HOLDLOCK) AS target
      USING OPENJSON(@payload) WITH (code varchar(40) '$.code', name nvarchar(120) '$.name') AS source
      ON target.codigo = source.code
      WHEN MATCHED THEN UPDATE SET nombre = source.name, activa = 1, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (codigo, nombre) VALUES (source.code, source.name);
    `);

    await jsonRequest(transaction, parsed.data.schools).query(`
      MERGE vcm.Escuela WITH (HOLDLOCK) AS target
      USING OPENJSON(@payload) WITH (name nvarchar(180) '$.name') AS source
      ON LOWER(target.nombre) = LOWER(source.name)
      WHEN MATCHED THEN UPDATE SET nombre = source.name, activa = 1, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (nombre) VALUES (source.name);
    `);

    await jsonRequest(transaction, parsed.data.subjects).query(`
      MERGE vcm.Asignatura WITH (HOLDLOCK) AS target
      USING (
        SELECT source.code, source.name, school.escuela_id AS schoolId
        FROM OPENJSON(@payload) WITH (
          code varchar(40) '$.code', name nvarchar(180) '$.name', schoolName nvarchar(180) '$.schoolName'
        ) source
        INNER JOIN vcm.Escuela school ON LOWER(school.nombre) = LOWER(source.schoolName)
      ) AS source
      ON target.codigo = source.code
      WHEN MATCHED THEN UPDATE SET nombre = source.name, escuela_id = source.schoolId, activa = 1, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (codigo, nombre, escuela_id) VALUES (source.code, source.name, source.schoolId);
    `);

    await jsonRequest(transaction, parsed.data.teachers).query(`
      MERGE vcm.Docente WITH (HOLDLOCK) AS target
      USING OPENJSON(@payload) WITH (sourceId nvarchar(200) '$.sourceId', name nvarchar(180) '$.name', email nvarchar(320) '$.email') AS source
      ON target.identificador_fuente = source.sourceId
      WHEN MATCHED THEN UPDATE SET nombre = source.name, correo = COALESCE(source.email, target.correo), activo = 1, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (identificador_fuente, nombre, correo) VALUES (source.sourceId, source.name, source.email);
    `);

    await new sql.Request(transaction).query(`
      ;WITH accountMatches AS (
        SELECT teacher.docente_id, usr.usuario_id,
          COUNT(*) OVER (PARTITION BY usr.usuario_id) AS teacherMatches
        FROM vcm.Docente teacher
        INNER JOIN vcm.Usuario usr
          ON LOWER(usr.correo) = LOWER(teacher.correo)
          AND usr.activo = 1
          AND usr.rol IN ('TEACHER', 'COORDINATOR')
        WHERE teacher.usuario_id IS NULL
          AND teacher.correo IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM vcm.Docente linkedTeacher
            WHERE linkedTeacher.usuario_id = usr.usuario_id
          )
      )
      UPDATE teacher
      SET usuario_id = match.usuario_id, actualizado_en = SYSUTCDATETIME()
      FROM vcm.Docente teacher
      INNER JOIN accountMatches match ON match.docente_id = teacher.docente_id
      WHERE match.teacherMatches = 1;
    `);

    await jsonRequest(transaction, parsed.data.sections)
      .input("loadId", sql.UniqueIdentifier, loadId)
      .query(`
        MERGE vcm.Seccion WITH (HOLDLOCK) AS target
        USING (
          SELECT subject.asignatura_id AS subjectId, campus.sede_id AS campusId, period.periodo_academico_id AS periodId,
                 source.code, source.shift
          FROM OPENJSON(@payload) WITH (period varchar(20) '$.period', campusCode varchar(40) '$.campusCode', subjectCode varchar(40) '$.subjectCode', code nvarchar(40) '$.code', shift nvarchar(40) '$.shift') source
          INNER JOIN vcm.Asignatura subject ON subject.codigo = source.subjectCode
          INNER JOIN vcm.Sede campus ON campus.codigo = source.campusCode
          INNER JOIN vcm.PeriodoAcademico period ON period.codigo = source.period
        ) AS source
        ON target.asignatura_id = source.subjectId AND target.sede_id = source.campusId AND target.periodo_academico_id = source.periodId AND target.codigo = source.code
        WHEN MATCHED THEN UPDATE SET jornada = source.shift, carga_academica_id = @loadId, activa = 1, actualizado_en = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (asignatura_id, sede_id, periodo_academico_id, codigo, jornada, carga_academica_id)
          VALUES (source.subjectId, source.campusId, source.periodId, source.code, source.shift, @loadId);
      `);

    await jsonRequest(transaction, parsed.data.sections)
      .input("loadId", sql.UniqueIdentifier, loadId)
      .query(`
        MERGE vcm.DocenteSeccion WITH (HOLDLOCK) AS target
        USING (
          SELECT teacher.docente_id AS teacherId, section.seccion_id AS sectionId
          FROM OPENJSON(@payload) WITH (period varchar(20) '$.period', campusCode varchar(40) '$.campusCode', subjectCode varchar(40) '$.subjectCode', code nvarchar(40) '$.code', teacherSourceId nvarchar(200) '$.teacherSourceId') source
          INNER JOIN vcm.Docente teacher ON teacher.identificador_fuente = source.teacherSourceId
          INNER JOIN vcm.Asignatura subject ON subject.codigo = source.subjectCode
          INNER JOIN vcm.Sede campus ON campus.codigo = source.campusCode
          INNER JOIN vcm.PeriodoAcademico period ON period.codigo = source.period
          INNER JOIN vcm.Seccion section ON section.asignatura_id = subject.asignatura_id AND section.sede_id = campus.sede_id AND section.periodo_academico_id = period.periodo_academico_id AND section.codigo = source.code
        ) AS source
        ON target.docente_id = source.teacherId AND target.seccion_id = source.sectionId
        WHEN MATCHED THEN UPDATE SET carga_academica_id = @loadId, vigente = 1
        WHEN NOT MATCHED THEN INSERT (docente_id, seccion_id, carga_academica_id) VALUES (source.teacherId, source.sectionId, @loadId);
      `);

    await jsonRequest(transaction, parsed.data.students).query(`
      MERGE vcm.Alumno WITH (HOLDLOCK) AS target
      USING OPENJSON(@payload) WITH (sourceId nvarchar(80) '$.sourceId', rut varchar(20) '$.rut', name nvarchar(180) '$.name', email nvarchar(320) '$.email') AS source
      ON target.rut = source.rut
      WHEN MATCHED THEN UPDATE SET identificador_externo = source.sourceId, nombre_completo = source.name, correo = source.email, activo = 1, actualizado_en = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (identificador_externo, rut, nombre_completo, correo) VALUES (source.sourceId, source.rut, source.name, source.email);
    `);

    await jsonRequest(transaction, parsed.data.enrollments)
      .input("sections", sql.NVarChar(sql.MAX), JSON.stringify(parsed.data.sections))
      .input("loadId", sql.UniqueIdentifier, loadId)
      .query(`
        MERGE vcm.Matricula WITH (HOLDLOCK) AS target
        USING (
          SELECT student.alumno_id AS studentId, subject.asignatura_id AS subjectId, section.seccion_id AS sectionId
          FROM OPENJSON(@payload) WITH (studentRut varchar(20) '$.studentRut', subjectCode varchar(40) '$.subjectCode', sectionKey nvarchar(180) '$.sectionKey') enrollment
          INNER JOIN OPENJSON(@sections) WITH ([key] nvarchar(180) '$.key', period varchar(20) '$.period', campusCode varchar(40) '$.campusCode', subjectCode varchar(40) '$.subjectCode', code nvarchar(40) '$.code') source ON source.[key] = enrollment.sectionKey
          INNER JOIN vcm.Alumno student ON student.rut = enrollment.studentRut
          INNER JOIN vcm.Asignatura subject ON subject.codigo = enrollment.subjectCode
          INNER JOIN vcm.Sede campus ON campus.codigo = source.campusCode
          INNER JOIN vcm.PeriodoAcademico period ON period.codigo = source.period
          INNER JOIN vcm.Seccion section ON section.asignatura_id = subject.asignatura_id AND section.sede_id = campus.sede_id AND section.periodo_academico_id = period.periodo_academico_id AND section.codigo = source.code
        ) AS source
        ON target.alumno_id = source.studentId AND target.asignatura_id = source.subjectId
        WHEN MATCHED THEN UPDATE SET seccion_id = source.sectionId, carga_academica_id = @loadId, vigente = 1
        WHEN NOT MATCHED THEN INSERT (alumno_id, asignatura_id, seccion_id, carga_academica_id) VALUES (source.studentId, source.subjectId, source.sectionId, @loadId);
      `);

    await new sql.Request(transaction)
      .input("loadId", sql.UniqueIdentifier, loadId)
      .input("campuses", sql.Int, parsed.summary.campuses)
      .input("schools", sql.Int, parsed.summary.schools)
      .input("subjects", sql.Int, parsed.summary.subjects)
      .input("sections", sql.Int, parsed.summary.sections)
      .input("teachers", sql.Int, parsed.summary.teachers)
      .input("students", sql.Int, parsed.summary.students)
      .input("warnings", sql.Int, parsed.summary.warnings)
      .query(`
        UPDATE vcm.CargaAcademica SET estado = 'APLICADA', aplicado_en = SYSUTCDATETIME(),
          total_sedes = @campuses, total_escuelas = @schools, total_asignaturas = @subjects, total_secciones = @sections,
          total_docentes = @teachers, total_alumnos = @students, total_advertencias = @warnings
        WHERE carga_academica_id = @loadId;
      `);
    await writeAudit(transaction, principal, {
      action: "ACADEMIC_IMPORT_APPLIED", entity: "CargaAcademica", entityId: loadId,
      description: `Carga académica ${filename.slice(0, 260)} aplicada.`,
      data: { period: parsed.data.period, ...parsed.summary },
    });
    return { id: loadId, duplicate: false, summary: parsed.summary };
  });
}

async function listAcademicImports() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP (20) CONVERT(varchar(36), carga_academica_id) AS id, nombre_archivo AS filename,
      periodo AS period, estado AS status, aplicado_por AS appliedBy, aplicado_en AS appliedAt,
      total_sedes AS campuses, total_escuelas AS schools, total_asignaturas AS subjects, total_secciones AS sections,
      total_docentes AS teachers, total_alumnos AS students, total_advertencias AS warnings
    FROM vcm.CargaAcademica ORDER BY creado_en DESC;
  `);
  return result.recordset;
}

module.exports = { applyAcademicImport, listAcademicImports };
