const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { AppError } = require("./http");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = "scrypt$16384$8$1$745304c8759cc28c1b2d9a97e231ce04$73e1aa0cf0b62bb104af751a0a89020b4ae16a6ae76fb039aa0c07e277624907a4e571bef13cff3c12b64f620082fc6d929710ec6c5b84d4f4432f3f820d8983";

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new AppError(400, "WEAK_PASSWORD", "La contraseña debe tener entre 10 y 128 caracteres.");
  }
  if (!/[a-záéíóúñ]/i.test(password) || !/\d/.test(password)) {
    throw new AppError(400, "WEAK_PASSWORD", "La contraseña debe incluir letras y al menos un número.");
  }
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash = DUMMY_HASH) {
  try {
    const [algorithm, n, r, p, salt, expectedHex] = storedHash.split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const key = await scrypt(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return expected.length === key.length && crypto.timingSafeEqual(expected, key);
  } catch {
    return false;
  }
}

module.exports = { DUMMY_HASH, hashPassword, validatePassword, verifyPassword };
