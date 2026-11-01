import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatAuditAction, sortAuditActions } from "../src/utils/auditLabels.js";

const addedLabels = {
  ACADEMIC_ADJUSTMENT: "Ajuste académico aplicado",
  ACADEMIC_TEACHER_CREATED: "Docente registrado manualmente",
  DIRECTOR_ACCOUNTS_UPSERTED: "Cuentas de directores de carrera creadas o actualizadas",
  PARTNER_UPDATED: "Socio formador actualizado",
  PARTNER_REVIEW_CREATED: "Enlace de revisión del socio creado",
  PARTNER_REVIEW_REVOKED: "Enlace de revisión del socio revocado",
  PROJECT_DELETED: "Proyecto eliminado",
  PROJECT_UPDATED: "Proyecto actualizado",
  SECTION_STUDENT_ADDED: "Alumno agregado a la sección",
  SECTION_STUDENT_REMOVED: "Alumno retirado de la sección",
  SECTION_TEACHER_REPLACED: "Docente de la sección reemplazado",
  TEACHER_ACCOUNT_PROVISIONED: "Cuenta y registro docente preparados",
  USER_EMAIL_UPDATED: "Correo de usuario actualizado",
  VIDEO_DELIVERY_LINKS_CREATED: "Enlaces de entrega de videos creados",
};

test("traduce acciones nuevas e históricas sin modificar sus códigos internos", () => {
  for (const [code, expected] of Object.entries(addedLabels)) {
    assert.equal(formatAuditAction(code), expected);
    assert.equal(formatAuditAction(` ${code.toLowerCase().replaceAll("_", "-")} `), expected);
  }
  assert.equal(formatAuditAction("PARTNER_REVIEW_CLOSED_INTERNALLY"), "Revisión del socio cerrada internamente");
  assert.equal(formatAuditAction("PROJECT_TEAMS_SAVED"), "Equipos del proyecto guardados");
});

test("todas las acciones literales de los repositorios y las dinámicas actuales tienen traducción", () => {
  const directory = fileURLToPath(new URL("../api/src/repositories/", import.meta.url));
  const codes = new Set([
    ...Object.keys(addedLabels), "ADMIN_ACCOUNT_PREPARED", "ADMINISTRATOR_ACCOUNT_PREPARED",
    "COORDINATOR_ACCOUNT_PREPARED", "DIRECTOR_ACCOUNT_PREPARED", "TEACHER_ACCOUNT_PREPARED",
    "TEST_TEACHERS_CREATED", "USER_ENABLED", "USER_DISABLED", "PROJECT_ANTECEDENT_UPLOADED",
    "PROJECT_ANTECEDENT_REPLACED", "PROJECT_DELIVERABLE_UPLOADED",
  ]);
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(path.join(directory, filename), "utf8");
    for (const match of source.matchAll(/\baction:\s*["']([A-Z][A-Z_]+)["']/g)) codes.add(match[1]);
  }
  for (const code of codes) {
    assert.doesNotMatch(formatAuditAction(code), /Acción no catalogada/, `Falta traducir ${code}`);
  }
});

test("el selector se ordena por nombre en español conservando los valores de filtrado y el arreglo original", () => {
  const actions = ["PROJECT_UPDATED", "SECTION_STUDENT_REMOVED", "ACADEMIC_ADJUSTMENT", "USER_EMAIL_UPDATED"];
  const original = [...actions];
  const sorted = sortAuditActions(actions);
  assert.deepEqual(sorted, ["ACADEMIC_ADJUSTMENT", "SECTION_STUDENT_REMOVED", "USER_EMAIL_UPDATED", "PROJECT_UPDATED"]);
  assert.deepEqual(actions, original);
  assert.deepEqual([...sorted].sort(), [...original].sort());
});

test("los valores vacíos y desconocidos tienen una indicación en español sin ocultar códigos nuevos", () => {
  for (const value of [null, undefined, "", "  "]) assert.equal(formatAuditAction(value), "Acción no informada");
  assert.equal(formatAuditAction("NEW_FUTURE_ACTION"), "Acción no catalogada (NEW_FUTURE_ACTION)");
  assert.equal(formatAuditAction("constructor"), "Acción no catalogada (CONSTRUCTOR)");
  assert.deepEqual(sortAuditActions(), []);
});
