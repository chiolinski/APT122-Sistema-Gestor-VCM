class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function response(status, body, headers = {}) {
  return {
    status,
    jsonBody: body,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  };
}

function ok(data, meta) {
  return response(200, meta ? { data, meta } : { data });
}

function created(data) {
  return response(201, { data });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "El cuerpo de la solicitud no contiene JSON válido.");
  }
}

function handleError(error, context) {
  if (error instanceof AppError) {
    return response(error.status, { error: { code: error.code, message: error.message, details: error.details } });
  }
  context?.error?.("Error no controlado", error);
  return response(500, { error: { code: "INTERNAL_ERROR", message: "No fue posible completar la operación." } });
}

module.exports = { AppError, created, handleError, ok, readJson, response };
