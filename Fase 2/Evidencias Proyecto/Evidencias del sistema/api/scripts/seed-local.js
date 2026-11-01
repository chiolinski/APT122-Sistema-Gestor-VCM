const fs = require("node:fs");
const path = require("node:path");
const { sql, getPool } = require("../src/lib/db");
const { hashPassword } = require("../src/lib/password");
const { validateAcademicRows } = require("../src/lib/academicRows");
const { applyAcademicImport } = require("../src/repositories/academicImportRepository");
const { createPartner } = require("../src/repositories/partnerRepository");
const { createProject } = require("../src/repositories/projectRepository");
const root = path.resolve(__dirname, "../..");
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, "fixtures", name), "utf8"));
async function main() {
  const pool = await getPool();
  try {
    // Los reruns no restablecen contraseñas ni revierten modificaciones del usuario.
    const password = await hashPassword("LocalVCM2026!");
    for (const account of load("accounts-local.json")) {
      await pool.request().input("email", sql.NVarChar(320), account.email).input("name", sql.NVarChar(180), account.name)
        .input("role", sql.VarChar(20), account.role).input("title", sql.NVarChar(100), account.title)
        .input("hash", sql.NVarChar(255), password).query(`
          IF NOT EXISTS (SELECT 1 FROM vcm.Usuario WHERE correo = @email)
          INSERT INTO vcm.Usuario (correo, nombre, rol, cargo_visual, password_hash, password_actualizado_en)
          VALUES (@email, @name, @role, @title, @hash, SYSUTCDATETIME());`);
    }
    const admin = (await pool.request().query("SELECT CONVERT(varchar(36), usuario_id) AS id, correo AS email FROM vcm.Usuario WHERE correo = 'admin@example.test';")).recordset[0];
    const principal = { ...admin, role: "admin", name: "Administración ficticia" };
    const parsed = validateAcademicRows(load("academic-local.json"));
    if (!parsed.canApply) throw new Error(JSON.stringify(parsed.issues));
    await applyAcademicImport(parsed, "academic-local.json", principal);
    const existing = await pool.request().query("SELECT TOP (1) socio_formador_id AS id FROM vcm.SocioFormador WHERE contacto_correo = 'socio@example.test';");
    const partner = existing.recordset[0] || await createPartner({ taxId: "99000001-8", businessName: "Socio ficticio local", industry: "Pruebas",
      contactName: "Contacto ficticio", contactEmail: "socio@example.test", phone: "" }, principal);
    const project = await pool.request().query("SELECT TOP (1) proyecto_id AS id FROM vcm.Proyecto WHERE nombre = N'Proyecto ficticio de pruebas locales';");
    if (!project.recordset.length) {
      const subject = (await pool.request().query("SELECT CONVERT(varchar(36), asignatura_id) AS id FROM vcm.Asignatura WHERE codigo = 'LOCAL101';")).recordset[0];
      const sections = (await pool.request().query("SELECT CONVERT(varchar(36), seccion_id) AS id, CONVERT(varchar(36), sede_id) AS campusId FROM vcm.Seccion WHERE asignatura_id = (SELECT asignatura_id FROM vcm.Asignatura WHERE codigo = 'LOCAL101');")).recordset;
      await createProject({ name: "Proyecto ficticio de pruebas locales", partnerId: partner.id, subjectId: subject.id,
        campusIds: [...new Set(sections.map((row) => row.campusId))], sectionIds: sections.map((row) => row.id),
        description: "Proyecto generado desde cero para probar permisos, equipos y los tres hitos por sección.",
        expectedResult: "Validación local del flujo completo con dos secciones y doce estudiantes ficticios." }, principal);
    }
    console.log("Datos sintéticos preparados: 5 cuentas, 2 secciones, 12 estudiantes y 1 proyecto. Clave inicial: LocalVCM2026!");
  } finally { await pool.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
