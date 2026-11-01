function getTeachingStatus(sectionStates, teachingSectionIds) {
  if (!Array.isArray(teachingSectionIds) || teachingSectionIds.length === 0) return null;

  const statesBySection = new Map((sectionStates || []).map((state) => [state.sectionId, state]));
  const assignedStates = teachingSectionIds.map((sectionId) => statesBySection.get(sectionId));
  const allClosed = assignedStates.every((state) => state?.milestones?.[2]?.status === "Completado");
  if (allClosed) return "Cerrado";

  const hasStarted = assignedStates.some((state) => state?.milestones?.some((milestone) => milestone.status === "Completado"));
  return hasStarted ? "En ejecución" : "Planificado";
}

module.exports = { getTeachingStatus };
