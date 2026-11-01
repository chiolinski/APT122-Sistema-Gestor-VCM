const { app } = require("@azure/functions");
const { requireAdmin } = require("../lib/auth");
const { handleError, ok, readJson } = require("../lib/http");
const { validId, validateAcademicAdjustment, validateTeacherRegistration } = require("../lib/academicManagement");
const { managementCatalogs, searchManagementSections, searchManagementPeople, managementSectionDetail,
  executeAcademicAdjustment, registerManagementTeacher } = require("../repositories/academicManagementRepository");

function adminEndpoint(name, methods, route, operation) {
  app.http(name, { methods, authLevel: "anonymous", route,
    handler: async (request, context) => {
      try {
        const principal = await requireAdmin(request);
        return ok(await operation(request, principal));
      } catch (error) { return handleError(error, context); }
    },
  });
}

adminEndpoint("academicManagementCatalogs", ["GET"], "academic-management/catalogs", () => managementCatalogs());
adminEndpoint("academicManagementSections", ["GET"], "academic-management/sections", (request) => {
  const query = new URL(request.url).searchParams;
  return searchManagementSections({ query: query.get("query"), campusId: query.get("campusId"), period: query.get("period") });
});
adminEndpoint("academicManagementSection", ["GET"], "academic-management/sections/{id}", (request) => (
  managementSectionDetail(validId(request.params.id, "La sección"))
));
adminEndpoint("academicManagementTeachers", ["GET"], "academic-management/teachers", (request) => (
  searchManagementPeople("teachers", new URL(request.url).searchParams.get("query") || "")
));
adminEndpoint("academicManagementStudents", ["GET"], "academic-management/students", (request) => (
  searchManagementPeople("students", new URL(request.url).searchParams.get("query") || "")
));
adminEndpoint("academicManagementTeacherCreate", ["POST"], "academic-management/teachers", async (request, principal) => (
  registerManagementTeacher(validateTeacherRegistration(await readJson(request)), principal)
));
adminEndpoint("academicManagementPreview", ["POST"], "academic-management/preview", async (request, principal) => (
  executeAcademicAdjustment(validateAcademicAdjustment(await readJson(request)), principal, true)
));
adminEndpoint("academicManagementApply", ["POST"], "academic-management/apply", async (request, principal) => (
  executeAcademicAdjustment(validateAcademicAdjustment(await readJson(request), true), principal)
));
