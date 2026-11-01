const UTF8_BOM = [0xEF, 0xBB, 0xBF];
const UTF16_LE_BOM = [0xFF, 0xFE];
const UTF16_BE_BOM = [0xFE, 0xFF];

function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function decode(bytes, encoding, options) {
  return new TextDecoder(encoding, options).decode(bytes);
}

/**
 * Reads CSV files exported by both modern tools (UTF-8) and Excel's legacy
 * "CSV (comma delimited)" format on Windows (Windows-1252/ANSI).
 */
export async function decodeCsvFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (startsWith(bytes, UTF8_BOM)) return decode(bytes, "utf-8");
  if (startsWith(bytes, UTF16_LE_BOM)) return decode(bytes, "utf-16le");
  if (startsWith(bytes, UTF16_BE_BOM)) return decode(bytes, "utf-16be");

  try {
    return decode(bytes, "utf-8", { fatal: true });
  } catch {
    return decode(bytes, "windows-1252");
  }
}
