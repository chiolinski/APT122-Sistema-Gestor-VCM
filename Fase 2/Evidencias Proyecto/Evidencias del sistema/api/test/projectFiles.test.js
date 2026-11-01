const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProjectFileDeletionAllowed, buildStorageKey, sanitizeFilename, validateProjectFile } = require("../src/lib/projectFiles");

const maxBytes = 15 * 1024 * 1024;

test("valida un antecedente general permitido", () => {
  const file = validateProjectFile({
    category: "antecedente",
    name: "Bases proyecto 2026.pdf",
    contentType: "application/pdf",
    size: 2048,
  }, maxBytes);
  assert.equal(file.category, "ANTECEDENTE");
  assert.equal(file.sectionId, null);
  assert.equal(file.extension, ".pdf");
});

test("exige sección para el entregable del Hito 2", () => {
  assert.throws(
    () => validateProjectFile({ category: "ENTREGABLE_HITO_2", name: "avance.docx", size: 20 }, maxBytes),
    (error) => error.status === 400 && error.code === "SECTION_REQUIRED",
  );
});

test("impide asociar el antecedente general a una sección", () => {
  assert.throws(
    () => validateProjectFile({ category: "ANTECEDENTE", sectionId: "section-1", name: "bases.pdf", size: 20 }, maxBytes),
    (error) => error.status === 400 && error.code === "SECTION_NOT_ALLOWED",
  );
});

test("rechaza extensiones no autorizadas y archivos sobre el máximo", () => {
  assert.throws(
    () => validateProjectFile({ category: "ANTECEDENTE", name: "programa.exe", size: 20 }, maxBytes),
    (error) => error.code === "FILE_TYPE_NOT_ALLOWED",
  );
  assert.throws(
    () => validateProjectFile({ category: "ANTECEDENTE", name: "bases.pdf", size: maxBytes + 1 }, maxBytes),
    (error) => error.status === 413 && error.code === "FILE_TOO_LARGE",
  );
});

test("sanea rutas y caracteres de control del nombre original", () => {
  assert.equal(sanitizeFilename("  carpeta\\informe\u0000 final.pdf  "), "carpeta-informe final.pdf");
});

test("construye una clave privada separada por proyecto, categoría y sección", () => {
  const key = buildStorageKey("project-1", "file-1", {
    category: "ENTREGABLE_HITO_2",
    sectionId: "section-2",
    extension: ".docx",
  });
  assert.equal(key, "projects/project-1/entregable_hito_2/section-2/file-1.docx");
});

test("permite eliminar el antecedente al coordinador que lo subió", () => {
  assert.doesNotThrow(() => assertProjectFileDeletionAllowed(
    { category: "ANTECEDENTE", uploadedBy: "user-1", projectStatus: "PLANIFICADO" },
    { id: "user-1", role: "coordinator" },
  ));
});

test("permite al administrador eliminar antecedentes de cualquier usuario", () => {
  assert.doesNotThrow(() => assertProjectFileDeletionAllowed(
    { category: "ANTECEDENTE", uploadedBy: "user-1", projectStatus: "PLANIFICADO" },
    { id: "admin-1", role: "admin" },
  ));
});

test("impide eliminar antecedentes ajenos al coordinador o desde otro rol", () => {
  const file = { category: "ANTECEDENTE", uploadedBy: "user-1", projectStatus: "PLANIFICADO" };
  assert.throws(
    () => assertProjectFileDeletionAllowed(file, { id: "user-2", role: "coordinator" }),
    (error) => error.status === 403 && error.code === "FILE_DELETE_DENIED",
  );
  assert.throws(
    () => assertProjectFileDeletionAllowed(file, { id: "user-1", role: "teacher" }),
    (error) => error.status === 403 && error.code === "FILE_DELETE_DENIED",
  );
});

test("impide eliminar entregables docentes y archivos de proyectos cerrados", () => {
  assert.throws(
    () => assertProjectFileDeletionAllowed(
      { category: "ENTREGABLE_HITO_2", uploadedBy: "user-1", projectStatus: "EN_EJECUCION" },
      { id: "user-1", role: "coordinator" },
    ),
    (error) => error.status === 403 && error.code === "FILE_DELETE_DENIED",
  );
  assert.throws(
    () => assertProjectFileDeletionAllowed(
      { category: "ANTECEDENTE", uploadedBy: "user-1", projectStatus: "FINALIZADO" },
      { id: "user-1", role: "coordinator" },
    ),
    (error) => error.status === 409 && error.code === "PROJECT_FILE_LOCKED",
  );
});

test("acepta un identificador válido al reemplazar un antecedente", () => {
  const replacementId = "b8ff45fc-c0ef-4d78-9650-59077d01a944";
  const file = validateProjectFile({
    category: "ANTECEDENTE", name: "correccion.pdf", size: 20, replaceFileId: replacementId,
  }, maxBytes);
  assert.equal(file.replaceFileId, replacementId);
});

test("rechaza reemplazos sin identificador válido o aplicados a entregables", () => {
  assert.throws(
    () => validateProjectFile({ category: "ANTECEDENTE", name: "bases.pdf", size: 20, replaceFileId: "archivo" }, maxBytes),
    (error) => error.status === 400 && error.code === "INVALID_REPLACEMENT_FILE",
  );
  assert.throws(
    () => validateProjectFile({
      category: "ENTREGABLE_HITO_2", sectionId: "b8ff45fc-c0ef-4d78-9650-59077d01a944",
      name: "avance.pdf", size: 20, replaceFileId: "c8ff45fc-c0ef-4d78-9650-59077d01a944",
    }, maxBytes),
    (error) => error.status === 400 && error.code === "INVALID_REPLACEMENT_FILE",
  );
});
