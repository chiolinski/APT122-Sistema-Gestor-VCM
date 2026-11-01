const { app } = require("@azure/functions");
const { requireRole, requireTeachingCapability, requireUser } = require("../lib/auth");
const { assertMonitoringAccess, currentDateInChile } = require("../lib/coordinationMonitoring");
const { writeCoordinationWorkbook } = require("../lib/coordinationWorkbook");
const { created, handleError, ok, readJson } = require("../lib/http");
const {
  validateMilestoneReopenInput,
  validateMilestoneScheduleInput,
  validateProgressInput,
  validateProjectInput,
} = require("../lib/operationalData");
const { validateStudentAssignmentUpdate, validateTeamAssignmentInput } = require("../lib/projectTeams");
const { validateManualStudentInput, validateStudentRemovalInput } = require("../lib/projectRoster");
const { validateProjectDeletionConfirmation } = require("../lib/projectDeletion");
const {
  addProjectStudent,
  closeProject,
  createProject,
  deleteProject,
  listProjectRoster,
  listProjects,
  reopenSectionMilestone,
  removeProjectStudent,
  saveProjectProgress,
  scheduleMilestoneTwo,
  startProject,
  updateProject,
  updateProjectStudentAssignment,
} = require("../repositories/projectRepository");
const {
  getCoordinationExportData,
  listCoordinationMonitoring,
  recordCoordinationExport,
} = require("../repositories/coordinationMonitoringRepository");

app.http("coordinationProjectMonitoring", {
  methods: ["GET"], authLevel: "anonymous", route: "projects/monitoring",
  handler: async (request, context) => {
    try {
      assertMonitoringAccess(await requireUser(request));
      return ok(await listCoordinationMonitoring());
    } catch (error) { return handleError(error, context); }
  },
});

app.http("exportCoordinationProjectMonitoring", {
  methods: ["GET"], authLevel: "anonymous", route: "projects/monitoring/export",
  handler: async (request, context) => {
    try {
      const principal = assertMonitoringAccess(await requireUser(request));
      const url = new URL(request.url);
      const data = await getCoordinationExportData({
        scope: url.searchParams.get("scope"),
        campus: url.searchParams.get("campus"),
        search: url.searchParams.get("search"),
      });
      const body = await writeCoordinationWorkbook(data);
      const partnerCount = new Set((data.partners || []).map((partner) => partner.id)).size;
      await recordCoordinationExport(principal, data.report, data.students.length, partnerCount);
      const filename = `seguimiento-vcm-2026-${currentDateInChile()}.xlsx`;
      return {
        status: 200,
        body,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": String(body.length),
          "Cache-Control": "no-store",
        },
      };
    } catch (error) { return handleError(error, context); }
  },
});

app.http("listProjects", {
  methods: ["GET"], authLevel: "anonymous", route: "projects",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator", "teacher"]);
      return ok(await listProjects(principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("createProject", {
  methods: ["POST"], authLevel: "anonymous", route: "projects",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      return created(await createProject(validateProjectInput(await readJson(request)), principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("projectRoster", {
  methods: ["GET"], authLevel: "anonymous", route: "projects/{id}/roster",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      return ok(await listProjectRoster(request.params.id, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("startProject", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/start",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      const assignment = validateTeamAssignmentInput(await readJson(request));
      return ok(await startProject(request.params.id, assignment, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("addManualProjectStudent", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/roster/manual",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      const input = validateManualStudentInput(await readJson(request));
      return created(await addProjectStudent(request.params.id, input, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("updateProject", {
  methods: ["PATCH"], authLevel: "anonymous", route: "projects/{id}",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin"]);
      return ok(await updateProject(request.params.id, validateProjectInput(await readJson(request)), principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("deleteProject", {
  methods: ["DELETE"], authLevel: "anonymous", route: "projects/{id}",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin"]);
      validateProjectDeletionConfirmation(await readJson(request), request.params.id);
      return ok(await deleteProject(request.params.id, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("updateProjectStudentAssignment", {
  methods: ["PATCH", "DELETE"], authLevel: "anonymous", route: "projects/{id}/roster/{studentId}",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      if (request.method === "DELETE") {
        const input = validateStudentRemovalInput(await readJson(request));
        return ok(await removeProjectStudent(request.params.id, request.params.studentId, input, principal));
      }
      const input = validateStudentAssignmentUpdate(await readJson(request));
      return ok(await updateProjectStudentAssignment(request.params.id, request.params.studentId, input, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("saveProjectProgress", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/progress",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      const progress = validateProgressInput(await readJson(request));
      return ok(await saveProjectProgress(request.params.id, progress, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("closeProject", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/close",
  handler: async (request, context) => {
    try {
      const principal = await requireTeachingCapability(request);
      const payload = await readJson(request);
      return ok(await closeProject(request.params.id, payload.sectionId, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("scheduleProjectMilestoneTwo", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/milestones/2/schedule",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      const input = validateMilestoneScheduleInput(await readJson(request));
      return ok(await scheduleMilestoneTwo(request.params.id, input, principal));
    } catch (error) { return handleError(error, context); }
  },
});

app.http("reopenProjectSectionMilestone", {
  methods: ["POST"], authLevel: "anonymous", route: "projects/{id}/milestones/{number}/reopen",
  handler: async (request, context) => {
    try {
      const principal = await requireRole(request, ["admin", "coordinator"]);
      const input = validateMilestoneReopenInput(await readJson(request), request.params.number);
      return ok(await reopenSectionMilestone(request.params.id, input, principal));
    } catch (error) { return handleError(error, context); }
  },
});
