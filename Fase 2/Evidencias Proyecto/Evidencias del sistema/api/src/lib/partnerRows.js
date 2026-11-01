const REQUIRED_FIELDS = ["rut", "razon_social", "nombre_contacto", "correo_contacto"];
const MAX_ROWS = 5000;
const MAX_BUSINESS_NAME_LENGTH = 350;

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRut(value) {
  const compact = clean(value).replace(/[.\s-]/g, "").toUpperCase();
  if (compact.length < 2) return compact;
  return `${compact.slice(0, -1)}-${compact.slice(-1)}`;
}

function isValidRut(value) {
  const normalized = normalizeRut(value);
  if (!/^\d{1,8}-[\dK]$/.test(normalized)) return false;
  const [body, verifier] = normalized.split("-");
  if (/^0+$/.test(body)) return false;
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? "0" : remainder === 10 ? "K" : String(remainder);
  return verifier === expected;
}

function isValidPhone(value) {
  const phone = clean(value);
  if (!phone) return true;
  const singlePhone = "(?:\\+\\d+ *)?(?:\\(\\d+\\) *)?\\d+(?: +\\d+)*";
  return new RegExp(`^${singlePhone}(?: +${singlePhone})?$`).test(phone);
}

function normalizePartner(source) {
  return {
    taxId: normalizeRut(source.rut),
    businessName: clean(source.razon_social),
    industry: clean(source.rubro) || null,
    contactName: clean(source.nombre_contacto),
    contactEmail: clean(source.correo_contacto).toLowerCase(),
    phone: clean(source.telefono) || null,
  };
}

function samePartner(left, right) {
  return ["taxId", "businessName", "industry", "contactName", "contactEmail", "phone"]
    .every((field) => left[field] === right[field]);
}

function validatePartnerRows(rows) {
  const issues = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      canApply: false,
      issues: [{ level: "error", code: "EMPTY_FILE", row: 0, message: "El archivo no contiene socios formadores." }],
      summary: { rows: 0, partners: 0, creates: 0, updates: 0, duplicates: 0, errors: 1, warnings: 0 },
      data: [],
    };
  }
  if (rows.length > MAX_ROWS) {
    return {
      canApply: false,
      issues: [{ level: "error", code: "TOO_MANY_ROWS", row: 0, message: `La carga admite un máximo de ${MAX_ROWS} filas.` }],
      summary: { rows: rows.length, partners: 0, creates: 0, updates: 0, duplicates: 0, errors: 1, warnings: 0 },
      data: [],
    };
  }

  const partners = new Map();
  let duplicates = 0;
  rows.forEach((source, index) => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(Object.entries(source || {}).map(([key, value]) => [key, clean(value)]));
    const missing = REQUIRED_FIELDS.filter((field) => !row[field]);
    if (missing.length) {
      issues.push({ level: "error", code: "MISSING_FIELDS", row: rowNumber, message: `Faltan datos obligatorios: ${missing.join(", ")}.` });
      return;
    }

    const partner = normalizePartner(row);
    if (!isValidRut(partner.taxId)) {
      issues.push({ level: "error", code: "INVALID_RUT", row: rowNumber, message: `El RUT ${row.rut} no es válido.` });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partner.contactEmail)) {
      issues.push({ level: "error", code: "INVALID_EMAIL", row: rowNumber, message: `El correo ${row.correo_contacto} no es válido.` });
      return;
    }
    if (!isValidPhone(partner.phone)) {
      issues.push({ level: "error", code: "INVALID_PHONE", row: rowNumber, message: "Ingresa uno o dos teléfonos usando solo números, espacios, paréntesis y un signo + al inicio." });
      return;
    }
    const limits = [
      ["razón social", partner.businessName, MAX_BUSINESS_NAME_LENGTH], ["rubro", partner.industry, 150],
      ["nombre de contacto", partner.contactName, 180], ["correo", partner.contactEmail, 320],
      ["teléfono", partner.phone, 40],
    ];
    const unreadable = limits.find(([, value]) => value?.includes("\uFFFD"));
    if (unreadable) {
      issues.push({
        level: "error",
        code: "INVALID_TEXT_ENCODING",
        row: rowNumber,
        message: `${unreadable[0]} contiene caracteres no legibles. Vuelve a guardar el CSV como UTF-8 o Windows-1252.`,
      });
      return;
    }
    const oversized = limits.find(([, value, limit]) => value && value.length > limit);
    if (oversized) {
      issues.push({ level: "error", code: "FIELD_TOO_LONG", row: rowNumber, message: `${oversized[0]} supera el máximo de ${oversized[2]} caracteres.` });
      return;
    }

    const previous = partners.get(partner.taxId);
    if (previous) {
      duplicates += 1;
      if (samePartner(previous, partner)) {
        issues.push({ level: "warning", code: "DUPLICATE_ROW", row: rowNumber, message: `${partner.taxId} está repetido con los mismos datos y se procesará una sola vez.` });
      } else {
        issues.push({ level: "error", code: "DUPLICATE_RUT_CONFLICT", row: rowNumber, message: `${partner.taxId} aparece más de una vez con información diferente.` });
      }
      return;
    }
    partners.set(partner.taxId, partner);
  });

  const errors = issues.filter((issue) => issue.level === "error").length;
  const warnings = issues.filter((issue) => issue.level === "warning").length;
  const data = [...partners.values()].sort((left, right) => left.taxId.localeCompare(right.taxId));
  return {
    canApply: errors === 0,
    issues,
    summary: { rows: rows.length, partners: data.length, creates: 0, updates: 0, duplicates, errors, warnings },
    data,
  };
}

module.exports = { MAX_BUSINESS_NAME_LENGTH, MAX_ROWS, REQUIRED_FIELDS, isValidPhone, isValidRut, normalizeRut, validatePartnerRows };
