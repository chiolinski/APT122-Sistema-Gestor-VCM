const { AppError } = require("./http");

function validateProjectDeletionConfirmation(input, publicCode) {
  const confirmationCode = String(input?.confirmationCode || "").trim();
  if (!confirmationCode || confirmationCode !== publicCode) {
    throw new AppError(
      400,
      "PROJECT_DELETE_CONFIRMATION_MISMATCH",
      "El código de confirmación no coincide con el proyecto que deseas eliminar.",
    );
  }
  return { confirmationCode };
}

module.exports = { validateProjectDeletionConfirmation };
