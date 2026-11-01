async function reportRequest(path) {
  const response = await fetch(`/api/${path}`, { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || "No fue posible consultar los reportes del piloto.");
  return payload.data;
}

export function getPilotOverview() {
  return reportRequest("pilot-reports/overview");
}

export function getPilotReport(dimension) {
  return reportRequest(`pilot-reports/${encodeURIComponent(dimension)}`);
}

export function getAuditEvents(query = "", page = 1, pageSize = 25) {
  const params = new URLSearchParams({ query, page: String(page), pageSize: String(pageSize) });
  return reportRequest(`audit-events?${params}`);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename, columns, records) {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(";"),
    ...records.map((record) => columns.map((column) => csvCell(record[column.key])).join(";")),
  ];
  const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
