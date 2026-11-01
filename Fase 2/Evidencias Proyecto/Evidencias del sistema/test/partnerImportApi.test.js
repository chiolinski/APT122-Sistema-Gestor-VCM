import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { parsePartnerCsv } from "../src/services/partnerImportApi.js";

const header = "rut;razon_social;rubro;nombre_contacto;correo_contacto;telefono\r\n";
const row = "82.557.000-4;Agrícola Ariztía LTDA.;Producción, procesamiento y distribución;Carolina González Álvarez;cgonzalez@ariztia.com;+56 9 8452 8497\r\n";

test("conserva tildes de un CSV UTF-8", async () => {
  const file = new Blob([header + row], { type: "text/csv" });

  const [partner] = await parsePartnerCsv(file);

  assert.equal(partner.razon_social, "Agrícola Ariztía LTDA.");
  assert.equal(partner.rubro, "Producción, procesamiento y distribución");
  assert.equal(partner.nombre_contacto, "Carolina González Álvarez");
});

test("conserva tildes de un CSV Windows-1252 exportado por Excel", async () => {
  const file = new Blob([Buffer.from(header + row, "latin1")], { type: "text/csv" });

  const [partner] = await parsePartnerCsv(file);

  assert.equal(partner.razon_social, "Agrícola Ariztía LTDA.");
  assert.equal(partner.rubro, "Producción, procesamiento y distribución");
  assert.equal(partner.nombre_contacto, "Carolina González Álvarez");
  assert.equal(partner.razon_social.includes("�"), false);
});
