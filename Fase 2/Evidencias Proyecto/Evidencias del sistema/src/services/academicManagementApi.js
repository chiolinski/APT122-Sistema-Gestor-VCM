async function request(path, options = {}) {
  const response = await fetch(`/api/academic-management/${path}`, {
    credentials: "same-origin", ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible consultar la gestión académica.");
  return payload.data;
}

export const managementCatalogs = () => request("catalogs");
export const managementSections = (filters, signal) => request(`sections?${new URLSearchParams(filters)}`, { signal });
export const managementSection = (id, signal) => request(`sections/${encodeURIComponent(id)}`, { signal });
export const managementPeople = (entity, query, signal) => request(`${entity}?${new URLSearchParams({ query })}`, { signal });
export const previewAdjustment = (input) => request("preview", { method: "POST", body: JSON.stringify(input) });
export const applyAdjustment = (input) => request("apply", { method: "POST", body: JSON.stringify(input) });
export const registerManagementTeacher = (input) => request("teachers", { method: "POST", body: JSON.stringify(input) });
