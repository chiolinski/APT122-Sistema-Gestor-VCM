const PREFIX = "DEMO26";
const PASSWORD = "LocalVCM2026!";
const SCENARIOS = [
  ["planificado", "Proyecto planificado"],
  ["hito1-parcial", "Hito 1 parcial entre secciones"],
  ["hito1-listo", "Hito 1 completo, pendiente de programación"],
  ["hito2-futuro", "Hito 2 programado para una fecha futura"],
  ["videos-pendientes", "Hito 2 abierto, videos pendientes"],
  ["videos-parciales", "Entrega parcial de videos"],
  ["revision-pendiente", "Revisión del socio sin respuestas"],
  ["revision-parcial", "Revisión del socio con respuestas parciales"],
  ["retroalimentacion-lista", "Retroalimentación final, pendiente de cierre docente"],
  ["hito2-parcial", "Hito 2 cerrado en una de tres secciones"],
  ["hito3-pendiente", "Hito 2 completo, pendiente de Hito 3"],
  ["hito3-parcial", "Hito 3 cerrado en una de tres secciones"],
  ["finalizado", "Proyecto finalizado"],
  ["reabierto", "Hito 2 reabierto con auditoría"],
  ["revision-vencida", "Revisión del socio vencida con respuestas parciales"],
  ["revision-revocada", "Revisión revocada, preparada para una nueva publicación"],
].map(([key, label]) => ({ key, label }));

const CAMPUS_NAMES = ["Aurora", "Bosque", "Cumbre", "Delta", "Estuario", "Faro", "Horizonte", "Laguna", "Mirador", "Pradera"];
const SCHOOL_NAMES = ["Tecnología", "Administración", "Comunicación", "Diseño", "Servicios", "Medioambiente"];
const SUBJECT_NAMES = [
  "Aplicaciones comunitarias", "Gestión de organizaciones", "Comunicación digital", "Diseño inclusivo",
  "Atención a la comunidad", "Sustentabilidad local", "Análisis de información", "Emprendimiento social",
  "Producción audiovisual", "Experiencias accesibles", "Logística comunitaria", "Eficiencia energética",
  "Seguridad digital", "Planificación de servicios", "Contenidos educativos", "Diseño de espacios",
];
const PROJECT_THEMES = [
  "Portal de talleres comunitarios", "Inventario para una agrupación vecinal", "Campaña de participación barrial",
  "Señalética accesible", "Agenda de servicios comunitarios", "Plan de reciclaje de la comunidad",
  "Tablero de indicadores vecinales", "Plan de emprendimiento solidario", "Cápsulas educativas",
  "Guía de accesibilidad", "Distribución de materiales", "Diagnóstico de ahorro energético",
  "Taller de navegación segura", "Programa de atención vecinal", "Biblioteca de recursos educativos",
  "Propuesta de espacio comunitario",
];

const pad = (value, width = 3) => String(value).padStart(width, "0");

function fictionalRut(bodyValue) {
  const body = String(bodyValue);
  let total = 0;
  let multiplier = 2;
  for (const digit of [...body].reverse()) {
    total += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const check = 11 - total % 11;
  return `${body}-${check === 11 ? "0" : check === 10 ? "K" : check}`;
}

function buildShowcase() {
  const accounts = [];
  for (const [category, count, role, title] of [
    ["admin", 5, "ADMIN", "Administrador"],
    ["coordinacion", 20, "COORDINATOR", "Coordinador CITT"],
    ["direccion", 25, "COORDINATOR", "Director de Carrera"],
    ["docente", 200, "TEACHER", "Docente"],
  ]) {
    for (let number = 1; number <= count; number += 1) {
      accounts.push({ category, number, email: `demo.${category}${pad(number)}@example.test`,
        name: `${title} ficticio DEMO26 ${pad(number)}`, role, title,
        ...(role === "TEACHER" ? { teacherSourceId: `${PREFIX}DOC${pad(number)}` } : {}) });
    }
  }
  const teachers = accounts.filter((account) => account.role === "TEACHER");
  const hybrids = accounts.filter((account) => account.category === "coordinacion" && account.number <= 10)
    .map((account) => ({ ...account, teacherSourceId: `${PREFIX}HIB${pad(account.number)}` }));
  const teachingAccounts = [...teachers, ...hybrids];
  const campuses = CAMPUS_NAMES.map((name, index) => ({ code: `${PREFIX}S${pad(index + 1, 2)}`, name: `Sede ficticia DEMO26 ${name}` }));
  const subjects = SUBJECT_NAMES.map((name, index) => ({ code: `${PREFIX}A${pad(index + 1, 2)}`,
    name: `DEMO26 · ${name}`, schoolName: `Escuela ficticia DEMO26 de ${SCHOOL_NAMES[index % SCHOOL_NAMES.length]}` }));
  const partners = Array.from({ length: 40 }, (_, index) => ({
    taxId: fictionalRut(98001001 + index), businessName: `Organización ficticia DEMO26 ${pad(index + 1)} · ${CAMPUS_NAMES[index % 10]}`,
    industry: SCHOOL_NAMES[index % SCHOOL_NAMES.length], contactName: `Contacto ficticio DEMO26 ${pad(index + 1)}`,
    contactEmail: `demo.socio${pad(index + 1)}@example.test`, phone: "",
  }));
  const projects = [];
  const academicRows = [];
  for (let repetition = 0; repetition < 5; repetition += 1) {
    for (const [scenarioIndex, scenario] of SCENARIOS.entries()) {
      const number = projects.length + 1;
      const subject = subjects[scenarioIndex];
      const project = { key: `${PREFIX}-${pad(number)}`, number, repetition, scenarioIndex, scenario: scenario.key,
        scenarioLabel: scenario.label, subjectCode: subject.code, partnerEmail: partners[(number - 1) % partners.length].contactEmail,
        creatorEmail: `demo.coordinacion${pad((number - 1) % 20 + 1)}@example.test`,
        name: `${PREFIX}-${pad(number)} · ${PROJECT_THEMES[scenarioIndex]} · ${scenario.label}`,
        description: `Caso enteramente ficticio para demostración local. ${scenario.label}. Se trabajan tres secciones de ${subject.name} con un socio ficticio. No representa personas ni organizaciones reales.`,
        expectedResult: `Prototipo y material de demostración de ${PROJECT_THEMES[scenarioIndex].toLowerCase()}, con evidencias sintéticas y retroalimentación ficticia.`,
        sections: [] };
      for (let sectionIndex = 0; sectionIndex < 3; sectionIndex += 1) {
        const ordinal = (number - 1) * 3 + sectionIndex;
        const teacher = teachingAccounts[ordinal % teachingAccounts.length];
        const campus = campuses[(number - 1 + sectionIndex) % campuses.length];
        const section = { code: `D${pad(number)}${sectionIndex + 1}D`, campusCode: campus.code,
          teacherEmail: teacher.email, teacherSourceId: teacher.teacherSourceId, students: [] };
        for (let studentIndex = 0; studentIndex < 12; studentIndex += 1) {
          const studentNumber = ordinal * 12 + studentIndex + 1;
          const row = { periodo: "2026-2", sede_codigo: campus.code, sede_nombre: campus.name,
            asignatura_codigo: subject.code, asignatura_nombre: subject.name, escuela_nombre: subject.schoolName,
            seccion_codigo: section.code, jornada: sectionIndex === 2 ? "Vespertina" : "Diurna",
            docente_id: teacher.teacherSourceId, docente_nombre: teacher.name, docente_correo: teacher.email,
            estudiante_id: `${PREFIX}ALU${pad(studentNumber, 4)}`, estudiante_rut: fictionalRut(91010000 + studentNumber),
            estudiante_nombre: `Estudiante ficticio DEMO26 ${pad(studentNumber, 4)}`,
            estudiante_correo: `demo.estudiante${pad(studentNumber, 4)}@example.test` };
          academicRows.push(row);
          section.students.push({ email: row.estudiante_correo, rut: row.estudiante_rut });
        }
        project.sections.push(section);
      }
      projects.push(project);
    }
  }
  return { version: 1, prefix: PREFIX, accounts, campuses, subjects, partners, projects, academicRows };
}

function buildAssignment(roster, sectionId) {
  const students = roster.filter((student) => student.sectionId === sectionId).sort((a, b) => a.email.localeCompare(b.email));
  if (students.length !== 12) throw new Error("La nómina ficticia debe contener doce estudiantes por sección.");
  return {
    teams: [1, 2, 3].map((number) => ({ sectionId, name: `Equipo ${number}`,
      studentIds: students.slice(0, 10).filter((_, index) => index % 3 === number - 1).map((student) => student.id) })),
    students: students.map((student, index) => ({ studentId: student.id, sectionId,
      status: index < 10 ? "ASIGNADO" : index === 10 ? "SIN_EQUIPO" : "DESERTOR" })),
  };
}

module.exports = { PREFIX, PASSWORD, SCENARIOS, buildShowcase, buildAssignment, fictionalRut };
