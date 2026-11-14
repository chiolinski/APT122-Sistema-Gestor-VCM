const crypto = require("node:crypto");
const { sql, getPool, withTransaction } = require("../src/lib/db");

const PERIOD = "ITEST-1";
const EMPTY_PERIOD = "ITEST-VACIO";
const PROJECT_CODE = "ITEST-001";
const SCHOOL = "Escuela de pruebas de integración";
const STATUSES = ["ASIGNADO", "ASIGNADO", "ASIGNADO", "ASIGNADO", "ASIGNADO", "ASIGNADO", "SIN_EQUIPO", "SIN_EQUIPO", "DESERTOR", "DESERTOR"];
const TEAMS = [
  { name: "Equipo A", video: true, rating: 5 },
  { name: "Equipo B", video: true, rating: 4 },
  { name: "Equipo C", video: false, rating: 4 },
];

const newId = () => crypto.randomUUID();
const newToken = () => crypto.randomBytes(32).toString("hex");

async function exec(connection, text, params = {}) {
  const request = new sql.Request(connection);
  for (const [name, value] of Object.entries(params)) request.input(name, value);
  return (await request.query(text)).recordset;
}

async function cleanup() {
  await exec(await getPool(), `
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    DECLARE @project uniqueidentifier = (SELECT proyecto_id FROM vcm.Proyecto WHERE codigo_publico = @projectCode);
    DELETE evaluation FROM vcm.EvaluacionSocioEquipo evaluation
      INNER JOIN vcm.RevisionSocio review ON review.revision_socio_id = evaluation.revision_socio_id
      WHERE review.proyecto_id = @project;
    DELETE FROM vcm.RevisionSocio WHERE proyecto_id = @project;
    DELETE FROM vcm.EntregaVideoEquipo WHERE proyecto_id = @project;
    DELETE FROM vcm.EquipoAlumno WHERE proyecto_id = @project;
    DELETE FROM vcm.Equipo WHERE proyecto_id = @project;
    DELETE FROM vcm.ProyectoAlumnoEstado WHERE proyecto_id = @project;
    DELETE FROM vcm.HitoProyectoSeccion WHERE proyecto_id = @project;
    DELETE FROM vcm.ProyectoSeccion WHERE proyecto_id = @project;
    DELETE FROM vcm.Proyecto WHERE proyecto_id = @project;
    DELETE FROM vcm.Matricula WHERE alumno_id IN (SELECT alumno_id FROM vcm.Alumno WHERE rut LIKE 'ITEST-%');
    DELETE FROM vcm.Alumno WHERE rut LIKE 'ITEST-%';
    DELETE FROM vcm.Seccion WHERE asignatura_id IN (SELECT asignatura_id FROM vcm.Asignatura WHERE codigo = 'ITEST01');
    DELETE FROM vcm.Asignatura WHERE codigo = 'ITEST01';
    DELETE FROM vcm.Escuela WHERE nombre = @schoolName;
    DELETE FROM vcm.PeriodoAcademico WHERE codigo = @periodCode;
    COMMIT;
  `, { projectCode: PROJECT_CODE, schoolName: SCHOOL, periodCode: PERIOD });
}

async function seed() {
  await cleanup();
  await withTransaction(async (tx) => {
    const [base] = await exec(tx, `
      SELECT
        (SELECT usuario_id FROM vcm.Usuario WHERE correo = 'coordinacion@example.test') AS creator,
        (SELECT TOP (1) socio_formador_id FROM vcm.SocioFormador ORDER BY creado_en) AS partner,
        (SELECT TOP (1) sede_id FROM vcm.Sede ORDER BY codigo) AS campus;
    `);
    if (!base.creator || !base.partner || !base.campus) throw new Error("Faltan los datos base: ejecuta npm run local:setup.");

    const ids = { period: newId(), school: newId(), subject: newId(), section: newId(), project: newId(), review: newId() };
    const params = { ...ids, ...base, periodCode: PERIOD, projectCode: PROJECT_CODE, schoolName: SCHOOL };

    await exec(tx, `
      INSERT INTO vcm.PeriodoAcademico (periodo_academico_id, codigo, nombre, activo)
      VALUES (@period, @periodCode, N'Período de pruebas de integración', 0);
      INSERT INTO vcm.Escuela (escuela_id, nombre) VALUES (@school, @schoolName);
      INSERT INTO vcm.Asignatura (asignatura_id, codigo, nombre, escuela_id)
      VALUES (@subject, 'ITEST01', N'Asignatura de pruebas de integración', @school);
      INSERT INTO vcm.Seccion (seccion_id, asignatura_id, sede_id, periodo_academico_id, codigo)
      VALUES (@section, @subject, @campus, @period, 'IT1');
      INSERT INTO vcm.Proyecto (proyecto_id, codigo_publico, nombre, socio_formador_id, asignatura_id,
        descripcion, resultado_esperado, estado, creado_por_usuario_id)
      VALUES (@project, @projectCode, N'Proyecto de pruebas de integración', @partner, @subject,
        N'Datos ficticios.', N'Datos ficticios.', 'EN_EJECUCION', @creator);
      INSERT INTO vcm.ProyectoSeccion (proyecto_id, seccion_id) VALUES (@project, @section);
      INSERT INTO vcm.HitoProyectoSeccion (proyecto_id, seccion_id, numero, estado, completado_en, completado_por_usuario_id)
      VALUES (@project, @section, 1, 'COMPLETADO', SYSUTCDATETIME(), @creator),
        (@project, @section, 2, 'PENDIENTE', NULL, NULL),
        (@project, @section, 3, 'PENDIENTE', NULL, NULL);
      INSERT INTO vcm.RevisionSocio (revision_socio_id, proyecto_id, seccion_id, socio_formador_id, token_hash,
        equipos_json, creado_por_usuario_id, vence_en, completado_en)
      VALUES (@review, @project, @section, @partner, @token, N'[]', @creator, DATEADD(day, 7, SYSUTCDATETIME()), SYSUTCDATETIME());
    `, { ...params, token: newToken() });

    const students = STATUSES.map((status, index) => ({ id: newId(), status, number: String(index + 1).padStart(2, "0") }));
    for (const student of students) {
      await exec(tx, `
        INSERT INTO vcm.Alumno (alumno_id, identificador_externo, rut, nombre_completo) VALUES (@student, @rut, @rut, @name);
        INSERT INTO vcm.Matricula (alumno_id, asignatura_id, seccion_id) VALUES (@student, @subject, @section);
        INSERT INTO vcm.ProyectoAlumnoEstado (proyecto_id, seccion_id, alumno_id, estado) VALUES (@project, @section, @student, @status);
      `, { ...params, student: student.id, rut: `ITEST-${student.number}`, name: `Alumno de integración ${student.number}`, status: student.status });
    }

    const assigned = students.filter((student) => student.status === "ASIGNADO");
    for (const [index, team] of TEAMS.entries()) {
      const teamId = newId();
      await exec(tx, `
        INSERT INTO vcm.Equipo (equipo_id, proyecto_id, seccion_id, nombre, creado_por_usuario_id)
        VALUES (@team, @project, @section, @name, @creator);
        INSERT INTO vcm.EquipoAlumno (equipo_id, alumno_id, proyecto_id) VALUES (@team, @first, @project), (@team, @second, @project);
        INSERT INTO vcm.EvaluacionSocioEquipo (revision_socio_id, equipo_id, fortalezas, mejoras, valoracion)
        VALUES (@review, @team, N'Buen trabajo en terreno.', N'Mejorar el cierre.', @rating);
      `, { ...params, team: teamId, name: team.name, first: assigned[index * 2].id, second: assigned[index * 2 + 1].id, rating: team.rating });
      if (team.video) {
        await exec(tx, `
          INSERT INTO vcm.EntregaVideoEquipo (proyecto_id, seccion_id, equipo_id, token_hash, vence_en,
            archivo_nombre, blob_confirmado, tamano_bytes, entregado_en)
          VALUES (@project, @section, @team, @token, DATEADD(day, 7, SYSUTCDATETIME()),
            N'video.mp4', @blob, 1024, SYSUTCDATETIME());
        `, { ...params, team: teamId, token: newToken(), blob: `integracion/${teamId}.mp4` });
      }
    }
  });
}

async function close() {
  await (await getPool()).close();
}

module.exports = { PERIOD, EMPTY_PERIOD, PROJECT_CODE, SCHOOL, seed, cleanup, close };
