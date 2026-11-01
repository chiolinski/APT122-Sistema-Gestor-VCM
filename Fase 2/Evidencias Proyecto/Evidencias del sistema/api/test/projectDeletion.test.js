const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProjectDeletionConfirmation } = require("../src/lib/projectDeletion");

test("acepta el código exacto como confirmación de eliminación", () => {
  assert.deepEqual(
    validateProjectDeletionConfirmation({ confirmationCode: "VCM-2026-015" }, "VCM-2026-015"),
    { confirmationCode: "VCM-2026-015" },
  );
});

test("rechaza una confirmación vacía o de otro proyecto", () => {
  assert.throws(
    () => validateProjectDeletionConfirmation({}, "VCM-2026-015"),
    (error) => error.status === 400 && error.code === "PROJECT_DELETE_CONFIRMATION_MISMATCH",
  );
  assert.throws(
    () => validateProjectDeletionConfirmation({ confirmationCode: "VCM-2026-016" }, "VCM-2026-015"),
    (error) => error.status === 400 && error.code === "PROJECT_DELETE_CONFIRMATION_MISMATCH",
  );
});

test("la confirmación distingue mayúsculas y minúsculas", () => {
  assert.throws(
    () => validateProjectDeletionConfirmation({ confirmationCode: "vcm-2026-015" }, "VCM-2026-015"),
    (error) => error.code === "PROJECT_DELETE_CONFIRMATION_MISMATCH",
  );
});
