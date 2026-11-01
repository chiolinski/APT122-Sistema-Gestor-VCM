async function controlRequest(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible consultar el centro de control.");
  return payload.data;
}

export function getDataQuality() {
  return controlRequest("control/data-quality");
}

export function getControlAudit(filters = {}) {
  const params = new URLSearchParams({
    query: filters.query || "",
    action: filters.action || "all",
    entity: filters.entity || "all",
    page: String(filters.page || 1),
    pageSize: String(filters.pageSize || 25),
  });
  return controlRequest(`control/audit?${params}`);
}

export function getNotifications() {
  return controlRequest("notifications");
}

export function markNotificationRead(key) {
  return controlRequest(`notifications/${encodeURIComponent(key)}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return controlRequest("notifications/read-all", { method: "POST" });
}
