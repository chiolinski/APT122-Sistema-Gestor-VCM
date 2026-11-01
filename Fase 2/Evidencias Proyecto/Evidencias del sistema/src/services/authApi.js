import { waitForSystemReady } from "./systemAvailability.js";

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "No fue posible completar la solicitud.");
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

export async function login(email, password, { signal, onAuthenticating } = {}) {
  await waitForSystemReady({ signal });
  signal?.throwIfAborted();
  onAuthenticating?.();
  return apiRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }), signal });
}

export async function getCurrentSession() {
  try {
    return await apiRequest("/api/auth/session");
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export function logout() {
  return apiRequest("/api/auth/logout", { method: "POST", body: "{}" });
}

export function changePassword(currentPassword, newPassword) {
  return apiRequest("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function getAccountProfile() {
  return apiRequest("/api/account/profile");
}

export function getUsers() {
  return apiRequest("/api/users");
}

export function createUser(user) {
  return apiRequest("/api/users", { method: "POST", body: JSON.stringify(user) });
}

export function setUserActive(userId, active) {
  return apiRequest(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ active }) });
}

export function resetUserPassword(userId, password) {
  return apiRequest(`/api/users/${userId}/password`, { method: "POST", body: JSON.stringify({ password }) });
}
