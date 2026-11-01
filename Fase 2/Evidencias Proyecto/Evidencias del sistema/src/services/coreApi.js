async function apiRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible completar la operación.");
  return payload.data;
}

export function listPartners() {
  return apiRequest("partners");
}

export function createPartner(partner) {
  return apiRequest("partners", { method: "POST", body: JSON.stringify(partner) });
}

export function updatePartner(partnerId, partner) {
  return apiRequest(`partners/${encodeURIComponent(partnerId)}`, { method: "PATCH", body: JSON.stringify(partner) });
}

export function listProjects() {
  return apiRequest("projects");
}

export function getCoordinationMonitoring() {
  return apiRequest("projects/monitoring");
}

export async function downloadCoordinationMonitoring(filters = {}) {
  const params = new URLSearchParams();
  if (filters.scope && filters.scope !== "all") params.set("scope", filters.scope);
  if (filters.campus && filters.campus !== "all") params.set("campus", filters.campus);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  const query = params.toString();
  const response = await fetch(`/api/projects/monitoring/export${query ? `?${query}` : ""}`, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || "No fue posible generar el archivo Excel.");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "seguimiento-vcm-2026.xlsx";
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export function createProject(project) {
  return apiRequest("projects", { method: "POST", body: JSON.stringify(project) });
}

export function updateProject(projectId, project) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify(project) });
}

export function deleteProject(projectId, confirmationCode) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
    body: JSON.stringify({ confirmationCode }),
  });
}

export async function uploadProjectFile(projectId, category, file, sectionId = null, replaceFileId = null) {
  const params = new URLSearchParams({ category });
  if (sectionId) params.set("sectionId", sectionId);
  if (replaceFileId) params.set("replaceFileId", replaceFileId);
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files?${params}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible subir el archivo.");
  return payload.data;
}

export async function downloadProjectFile(projectId, fileId) {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, {
    headers: { Accept: "application/octet-stream" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || "No fue posible descargar el archivo.");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const fallbackName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : (fallbackName || "archivo-proyecto");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export function deleteProjectFile(projectId, fileId) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
  });
}

export function getProjectRoster(projectId) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/roster`);
}

export function addProjectStudent(projectId, student) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/roster/manual`, {
    method: "POST",
    body: JSON.stringify(student),
  });
}

export function removeProjectStudent(projectId, studentId, sectionId) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/roster/${encodeURIComponent(studentId)}`, {
    method: "DELETE",
    body: JSON.stringify({ sectionId }),
  });
}

export function startProject(projectId, teams, students) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/start`, {
    method: "POST",
    body: JSON.stringify({ teams, students }),
  });
}

export function updateProjectStudentAssignment(projectId, studentId, assignment) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/roster/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(assignment),
  });
}

export function saveProjectProgress(projectId, sectionId, progress) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/progress`, {
    method: "POST",
    body: JSON.stringify({ ...progress, sectionId }),
  });
}

export function closeProject(projectId, sectionId) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/close`, {
    method: "POST",
    body: JSON.stringify({ sectionId }),
  });
}

export function scheduleProjectMilestoneTwo(projectId, availableFrom) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/milestones/2/schedule`, {
    method: "POST",
    body: JSON.stringify({ availableFrom }),
  });
}

export function reopenProjectMilestone(projectId, sectionId, milestoneNumber, reason) {
  return apiRequest(`projects/${encodeURIComponent(projectId)}/milestones/${milestoneNumber}/reopen`, {
    method: "POST",
    body: JSON.stringify({ sectionId, reason }),
  });
}
