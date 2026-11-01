const ACTION_LABELS = {
  ACADEMIC_ADJUSTMENT: "Ajuste académico aplicado",
  ACADEMIC_IMPORT_APPLIED: "Carga académica aplicada",
  ACADEMIC_RECORD_UPDATED: "Registro académico actualizado",
  ACADEMIC_TEACHER_CREATED: "Docente registrado manualmente",
  ADMIN_ACCOUNT_PREPARED: "Cuenta de administrador preparada",
  ADMINISTRATOR_ACCOUNT_PREPARED: "Cuenta de administrador preparada",
  COORDINATOR_ACCOUNT_PREPARED: "Cuenta de coordinador CITT preparada",
  DIRECTOR_ACCOUNT_PREPARED: "Cuenta de director de carrera preparada",
  DIRECTOR_ACCOUNTS_UPSERTED: "Cuentas de directores de carrera creadas o actualizadas",
  MONITORING_EXPORTED: "Seguimiento exportado",
  PARTNER_IMPORT_APPLIED: "Carga de socios formadores aplicada",
  PARTNER_SAVED: "Socio formador guardado",
  PARTNER_UPDATED: "Socio formador actualizado",
  PARTNER_REVIEW_CLOSED_INTERNALLY: "Revisión del socio cerrada internamente",
  PARTNER_REVIEW_CREATED: "Enlace de revisión del socio creado",
  PARTNER_REVIEW_REVOKED: "Enlace de revisión del socio revocado",
  PARTNER_REVIEWS_BULK_CLOSED: "Cierre masivo de enlaces del socio formador",
  PASSWORD_CHANGED: "Contraseña actualizada",
  PROJECT_ANTECEDENT_DELETED: "Antecedente del proyecto eliminado",
  PROJECT_ANTECEDENT_REPLACED: "Antecedente del proyecto reemplazado",
  PROJECT_ANTECEDENT_UPLOADED: "Antecedente del proyecto cargado",
  PROJECT_BLOB_CLEANUP_PENDING: "Limpieza de archivo pendiente",
  PROJECT_CREATED: "Proyecto creado",
  PROJECT_DELETED: "Proyecto eliminado",
  PROJECT_DELIVERABLE_UPLOADED: "Entregable del proyecto cargado",
  PROJECT_MILESTONE_TWO_SCHEDULED: "Hito 2 del proyecto programado",
  PROJECT_SECTION_CLOSED: "Sección del proyecto cerrada",
  PROJECT_SECTION_MILESTONE_REOPENED: "Hito de sección reabierto",
  PROJECT_SECTION_PROGRESS_SAVED: "Avance de sección guardado",
  PROJECT_STUDENT_ASSIGNMENT_UPDATED: "Estado del estudiante actualizado",
  PROJECT_TEAMS_SAVED: "Equipos del proyecto guardados",
  PROJECT_UPDATED: "Proyecto actualizado",
  SECTION_STUDENT_ADDED: "Alumno agregado a la sección",
  SECTION_STUDENT_REMOVED: "Alumno retirado de la sección",
  SECTION_TEACHER_REPLACED: "Docente de la sección reemplazado",
  TEST_TEACHERS_CREATED: "Docentes de prueba creados",
  TEACHER_ACCOUNT_PREPARED: "Cuenta de docente preparada",
  TEACHER_ACCOUNT_PROVISIONED: "Cuenta y registro docente preparados",
  USER_CREATED: "Usuario creado",
  USER_DISABLED: "Usuario deshabilitado",
  USER_ENABLED: "Usuario habilitado",
  USER_EMAIL_UPDATED: "Correo de usuario actualizado",
  VIDEO_DELIVERY_LINKS_CREATED: "Enlaces de entrega de videos creados",
};

export function formatAuditAction(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (!code) return "Acción no informada";
  return Object.hasOwn(ACTION_LABELS, code) ? ACTION_LABELS[code] : `Acción no catalogada (${code})`;
}

export function sortAuditActions(actions = []) {
  return [...actions].sort((left, right) => formatAuditAction(left).localeCompare(formatAuditAction(right), "es"));
}
