const { AppError } = require("../lib/http");
const { ENTITIES } = require("../lib/academicRecords");
const { sql, getPool, withTransaction } = require("../lib/db");
const { writeAudit } = require("../lib/audit");

const QUERIES = {
  campuses: {
    from: "vcm.Sede campus",
    search: "campus.codigo LIKE @pattern OR campus.nombre LIKE @pattern",
    order: "campus.nombre, campus.codigo",
    select: `CONVERT(varchar(36), campus.sede_id) AS id, campus.codigo AS code, campus.nombre AS name,
      campus.activa AS active,
      (SELECT COUNT(*) FROM vcm.Seccion section WHERE section.sede_id = campus.sede_id) AS sections`,
  },
  schools: {
    from: "vcm.Escuela school",
    search: "school.nombre LIKE @pattern",
    order: "school.nombre",
    select: `CONVERT(varchar(36), school.escuela_id) AS id, school.nombre AS name,
      school.activa AS active,
      (SELECT COUNT(*) FROM vcm.Asignatura subject WHERE subject.escuela_id = school.escuela_id) AS subjects`,
  },
  subjects: {
    from: "vcm.Asignatura subject LEFT JOIN vcm.Escuela school ON school.escuela_id = subject.escuela_id",
    search: "subject.codigo LIKE @pattern OR subject.nombre LIKE @pattern OR school.nombre LIKE @pattern",
    order: "subject.codigo, subject.nombre",
    select: `CONVERT(varchar(36), subject.asignatura_id) AS id, subject.codigo AS code, subject.nombre AS name,
      school.nombre AS schoolName,
      subject.activa AS active,
      (SELECT COUNT(*) FROM vcm.Seccion section WHERE section.asignatura_id = subject.asignatura_id) AS sections,
      (SELECT COUNT(DISTINCT enrollment.alumno_id) FROM vcm.Matricula enrollment WHERE enrollment.asignatura_id = subject.asignatura_id AND enrollment.vigente = 1) AS students`,
  },
  sections: {
    from: `vcm.Seccion section
      INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = section.asignatura_id
      INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
      INNER JOIN vcm.PeriodoAcademico period ON period.periodo_academico_id = section.periodo_academico_id`,
    search: `section.codigo LIKE @pattern OR section.jornada LIKE @pattern OR subject.codigo LIKE @pattern
      OR subject.nombre LIKE @pattern OR campus.nombre LIKE @pattern OR period.codigo LIKE @pattern`,
    order: "period.codigo DESC, subject.codigo, campus.nombre, section.codigo",
    select: `CONVERT(varchar(36), section.seccion_id) AS id, section.codigo AS code, section.jornada AS shift,
      section.activa AS active, subject.codigo AS subjectCode, subject.nombre AS subjectName,
      campus.codigo AS campusCode, campus.nombre AS campusName, period.codigo AS period,
      (SELECT COUNT(*) FROM vcm.Matricula enrollment WHERE enrollment.seccion_id = section.seccion_id AND enrollment.vigente = 1) AS students,
      teacherSummary.names AS teacherNames`,
    apply: `OUTER APPLY (
      SELECT STRING_AGG(names.name, N', ') AS names
      FROM (
        SELECT DISTINCT teacher.nombre AS name
        FROM vcm.DocenteSeccion assignment
        INNER JOIN vcm.Docente teacher ON teacher.docente_id = assignment.docente_id
        WHERE assignment.seccion_id = section.seccion_id AND assignment.vigente = 1
      ) names
    ) teacherSummary`,
  },
  teachers: {
    from: "vcm.Docente teacher LEFT JOIN vcm.Usuario usr ON usr.usuario_id = teacher.usuario_id",
    search: `teacher.identificador_fuente LIKE @pattern OR teacher.nombre LIKE @pattern
      OR teacher.correo LIKE @pattern OR usr.correo LIKE @pattern`,
    order: "teacher.nombre, teacher.identificador_fuente",
    select: `CONVERT(varchar(36), teacher.docente_id) AS id, teacher.identificador_fuente AS sourceId,
      teacher.nombre AS name, teacher.correo AS email, teacher.activo AS active,
      usr.correo AS userEmail,
      (SELECT COUNT(*) FROM vcm.DocenteSeccion assignment WHERE assignment.docente_id = teacher.docente_id AND assignment.vigente = 1) AS sections,
      (SELECT COUNT(DISTINCT section.asignatura_id) FROM vcm.DocenteSeccion assignment
        INNER JOIN vcm.Seccion section ON section.seccion_id = assignment.seccion_id
        WHERE assignment.docente_id = teacher.docente_id AND assignment.vigente = 1) AS subjects`,
  },
  students: {
    from: "vcm.Alumno student",
    search: `student.rut LIKE @pattern OR student.identificador_externo LIKE @pattern
      OR student.nombre_completo LIKE @pattern OR student.correo LIKE @pattern`,
    order: "student.nombre_completo, student.rut",
    select: `CONVERT(varchar(36), student.alumno_id) AS id, student.identificador_externo AS sourceId,
      student.rut, student.nombre_completo AS name, student.correo AS email, student.activo AS active,
      (SELECT COUNT(*) FROM vcm.Matricula enrollment WHERE enrollment.alumno_id = student.alumno_id AND enrollment.vigente = 1) AS enrollments,
      enrollmentSummary.details AS enrollmentDetails`,
    apply: `OUTER APPLY (
      SELECT STRING_AGG(details.detail, N' · ') AS details
      FROM (
        SELECT CONCAT(subject.codigo, N' / ', section.codigo, N' / ', campus.nombre) AS detail
        FROM vcm.Matricula enrollment
        INNER JOIN vcm.Asignatura subject ON subject.asignatura_id = enrollment.asignatura_id
        INNER JOIN vcm.Seccion section ON section.seccion_id = enrollment.seccion_id
        INNER JOIN vcm.Sede campus ON campus.sede_id = section.sede_id
        WHERE enrollment.alumno_id = student.alumno_id AND enrollment.vigente = 1
      ) details
    ) enrollmentSummary`,
  },
};

async function getCounts(pool) {
  const result = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM vcm.Sede) AS campuses,
      (SELECT COUNT(*) FROM vcm.Escuela) AS schools,
      (SELECT COUNT(*) FROM vcm.Asignatura) AS subjects,
      (SELECT COUNT(*) FROM vcm.Seccion) AS sections,
      (SELECT COUNT(*) FROM vcm.Docente) AS teachers,
      (SELECT COUNT(*) FROM vcm.Alumno) AS students;
  `);
  return result.recordset[0];
}

async function listAcademicRecords(entity, query = "", page = 1, pageSize = 25) {
  if (!ENTITIES.includes(entity)) throw new AppError(400, "INVALID_ACADEMIC_ENTITY", "El tipo de dato académico no es válido.");
  const definition = QUERIES[entity];
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 25));
  const pool = await getPool();
  const request = pool.request()
    .input("pattern", sql.NVarChar(320), `%${String(query || "").trim().slice(0, 300)}%`)
    .input("offset", sql.Int, (safePage - 1) * safePageSize)
    .input("pageSize", sql.Int, safePageSize);
  const apply = definition.apply || "";
  const [recordsResult, counts] = await Promise.all([
    request.query(`
      SELECT COUNT(*) OVER() AS filteredTotal, ${definition.select}
      FROM ${definition.from}
      ${apply}
      WHERE ${definition.search}
      ORDER BY ${definition.order}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
    `),
    getCounts(pool),
  ]);
  const records = recordsResult.recordset.map((record) => {
    const output = { ...record };
    delete output.filteredTotal;
    return output;
  });
  return {
    entity, records, counts,
    total: recordsResult.recordset[0]?.filteredTotal || 0,
    page: safePage, pageSize: safePageSize,
  };
}

async function updateAcademicRecord(entity, id, input, principal) {
  if (!ENTITIES.includes(entity)) throw new AppError(400, "INVALID_ACADEMIC_ENTITY", "El tipo de dato académico no es válido.");
  try {
    return await withTransaction(async (transaction) => {
      const request = new sql.Request(transaction).input("id", sql.UniqueIdentifier, id);
      let statement;
      if (entity === "campuses") {
        request.input("code", sql.VarChar(40), input.code).input("name", sql.NVarChar(120), input.name).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Sede SET codigo=@code, nombre=@name, activa=@active, actualizado_en=SYSUTCDATETIME() WHERE sede_id=@id;";
      } else if (entity === "schools") {
        request.input("name", sql.NVarChar(180), input.name).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Escuela SET nombre=@name, activa=@active, actualizado_en=SYSUTCDATETIME() WHERE escuela_id=@id;";
      } else if (entity === "subjects") {
        let schoolId = null;
        if (input.schoolName) {
          const school = await new sql.Request(transaction)
            .input("name", sql.NVarChar(180), input.schoolName)
            .query(`
              MERGE vcm.Escuela WITH (HOLDLOCK) AS target
              USING (SELECT @name AS name) AS source ON LOWER(target.nombre) = LOWER(source.name)
              WHEN MATCHED THEN UPDATE SET activa = 1, actualizado_en = SYSUTCDATETIME()
              WHEN NOT MATCHED THEN INSERT (nombre) VALUES (source.name)
              OUTPUT CONVERT(varchar(36), inserted.escuela_id) AS id;
            `);
          schoolId = school.recordset[0].id;
        }
        request.input("code", sql.VarChar(40), input.code).input("name", sql.NVarChar(180), input.name)
          .input("schoolId", sql.UniqueIdentifier, schoolId).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Asignatura SET codigo=@code, nombre=@name, escuela_id=@schoolId, activa=@active, actualizado_en=SYSUTCDATETIME() WHERE asignatura_id=@id;";
      } else if (entity === "sections") {
        request.input("code", sql.NVarChar(40), input.code).input("shift", sql.NVarChar(40), input.shift).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Seccion SET codigo=@code, jornada=@shift, activa=@active, actualizado_en=SYSUTCDATETIME() WHERE seccion_id=@id;";
      } else if (entity === "teachers") {
        request.input("sourceId", sql.NVarChar(200), input.sourceId).input("name", sql.NVarChar(180), input.name)
          .input("email", sql.NVarChar(320), input.email).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Docente SET identificador_fuente=@sourceId, nombre=@name, correo=@email, activo=@active, actualizado_en=SYSUTCDATETIME() WHERE docente_id=@id;";
      } else {
        request.input("sourceId", sql.NVarChar(80), input.sourceId).input("rut", sql.VarChar(20), input.rut)
          .input("name", sql.NVarChar(180), input.name).input("email", sql.NVarChar(320), input.email).input("active", sql.Bit, input.active);
        statement = "UPDATE vcm.Alumno SET identificador_externo=@sourceId, rut=@rut, nombre_completo=@name, correo=@email, activo=@active, actualizado_en=SYSUTCDATETIME() WHERE alumno_id=@id;";
      }
      const result = await request.query(`${statement} SELECT @@ROWCOUNT AS affected;`);
      if (!result.recordset[0]?.affected) throw new AppError(404, "ACADEMIC_RECORD_NOT_FOUND", "No se encontró el registro académico.");
      await writeAudit(transaction, principal, {
        action: "ACADEMIC_RECORD_UPDATED", entity, entityId: id,
        description: `Registro académico actualizado en ${entity}.`, data: input,
      });
      return { id, updated: true };
    });
  } catch (error) {
    if ([2601, 2627].includes(error.number)) {
      throw new AppError(409, "ACADEMIC_VALUE_IN_USE", "El código, RUT o identificador ya está utilizado por otro registro.");
    }
    throw error;
  }
}

module.exports = { listAcademicRecords, updateAcademicRecord };
