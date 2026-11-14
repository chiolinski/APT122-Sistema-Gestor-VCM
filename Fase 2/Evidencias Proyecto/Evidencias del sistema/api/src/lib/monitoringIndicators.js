const key = (value) => String(value || "").toLowerCase();
const percent = (part, total) => total ? Math.round(part / total * 1000) / 10 : 0;
const rounded = (value) => Math.round(value * 100) / 100;
const ratio = (numerator, denominator) => ({ numerator, denominator, percent: denominator ? percent(numerator, denominator) : null });
const MIN_PROJECT_RATING_SAMPLE = 3;

function buildMonitoringIndicators(projects = [], studentRows = [], reviewRows = []) {
  const included = projects.filter((project) => project.status !== "Cancelado");
  const scope = new Map(included.map((project) => [key(project.databaseId), new Set(project.sections.map((section) => key(section.id)))]));
  const inScope = (row) => scope.get(key(row.projectId))?.has(key(row.sectionId));
  const activityByProject = new Map(included.filter((project) => ["En ejecución", "Finalizado"].includes(project.status))
    .map((project) => [key(project.databaseId), {
      students: new Set(), participants: new Set(), dropped: new Set(), teams: new Set(), delivered: new Set(),
      reviews: new Set(), completedReviews: new Set(),
    }]));
  const students = new Set();
  const participants = new Set();
  const teams = new Set();
  for (const row of studentRows) {
    if (!inScope(row) || !row.studentId) continue;
    const studentId = key(row.studentId);
    const activity = activityByProject.get(key(row.projectId));
    students.add(studentId);
    activity?.students.add(studentId);
    if (row.assignmentStatus === "DESERTOR") activity?.dropped.add(studentId);
    if (row.teamId && row.assignmentStatus === "ASIGNADO") {
      const teamId = key(row.teamId);
      participants.add(studentId);
      teams.add(teamId);
      activity?.participants.add(studentId);
      activity?.teams.add(teamId);
      if (row.videoDelivered) activity?.delivered.add(teamId);
    }
  }
  const invited = new Set();
  const responding = new Set();
  const reviews = new Set();
  const answered = new Set();
  const evaluations = new Set();
  const ratingsByProject = new Map();
  for (const row of reviewRows) {
    if (!inScope(row) || !row.reviewId || !row.partnerId || (row.revoked && !row.usedForClosure)) continue;
    const reviewId = key(row.reviewId);
    const projectId = key(row.projectId);
    const activity = activityByProject.get(projectId);
    invited.add(key(row.partnerId));
    reviews.add(reviewId);
    if (!row.revoked) {
      activity?.reviews.add(reviewId);
      if (row.completedByPartner) activity?.completedReviews.add(reviewId);
    }
    const rating = Number(row.rating);
    if (!row.teamId || !Number.isInteger(rating) || rating < 1 || rating > 5) continue;
    const evaluationId = `${reviewId}:${key(row.teamId)}`;
    if (evaluations.has(evaluationId)) continue;
    evaluations.add(evaluationId);
    responding.add(key(row.partnerId));
    answered.add(reviewId);
    if (!ratingsByProject.has(projectId)) ratingsByProject.set(projectId, { sum: 0, count: 0 });
    const current = ratingsByProject.get(projectId);
    current.sum += rating;
    current.count += 1;
  }
  const projectAverages = [...ratingsByProject.values()].map(({ sum, count }) => sum / count);
  const sections = included.flatMap((project) => project.sections);
  const completedMilestones = sections.reduce((sum, section) => sum + section.milestones.filter((milestone) => milestone.status === "Completado").length, 0);
  const completedSections = sections.filter((section) => section.milestones.every((milestone) => milestone.status === "Completado")).length;
  const teachers = included.flatMap((project) => project.teachers);
  const projectsBySchool = new Map();
  const projectDetails = [];
  for (const project of included) {
    const school = project.schoolName || "Sin escuela";
    projectsBySchool.set(school, (projectsBySchool.get(school) || 0) + 1);
    const projectId = key(project.databaseId);
    const activity = activityByProject.get(projectId);
    if (!activity) continue;
    // Un alumno asignado en otra sección del mismo proyecto sigue participando.
    const dropped = [...activity.dropped].filter((id) => !activity.participants.has(id)).length;
    const rating = ratingsByProject.get(projectId);
    const evaluationCount = rating?.count ?? 0;
    projectDetails.push({
      code: project.id,
      name: project.name,
      school,
      participation: ratio(activity.participants.size, activity.students.size - dropped),
      dropout: ratio(dropped, activity.students.size),
      videoDelivery: ratio(activity.delivered.size, activity.teams.size),
      milestones: project.completedByMilestone.map((completed) => ratio(completed, project.sectionCount)),
      partnerResponse: ratio(activity.completedReviews.size, activity.reviews.size),
      evaluationCount,
      partnerRating: evaluationCount >= MIN_PROJECT_RATING_SAMPLE ? rounded(rating.sum / evaluationCount) : null,
    });
  }
  const sumMetric = (metric) => ratio(
    projectDetails.reduce((sum, project) => sum + project[metric].numerator, 0),
    projectDetails.reduce((sum, project) => sum + project[metric].denominator, 0),
  );
  const countProjects = (metric, matches) => {
    const evaluable = projectDetails.map((project) => project[metric]).filter((value) => value.denominator > 0);
    return ratio(evaluable.filter(matches).length, evaluable.length);
  };
  return {
    projectCount: included.length,
    enrolledStudents: students.size,
    participatingStudents: participants.size,
    studentParticipationPercent: percent(participants.size, students.size),
    participatingTeachers: new Set(teachers.map((teacher) => key(teacher.id)).filter(Boolean)).size,
    formedTeams: teams.size,
    linkedPartners: new Set(included.map((project) => key(project.partnerId)).filter(Boolean)).size,
    partnersInvited: invited.size,
    respondingPartners: responding.size,
    partnerResponsePercent: percent(responding.size, invited.size),
    reviewCount: reviews.size,
    answeredReviewCount: answered.size,
    ratingCount: evaluations.size,
    ratedProjects: projectAverages.length,
    averageProjectRating: projectAverages.length ? rounded(projectAverages.reduce((sum, average) => sum + average, 0) / projectAverages.length) : null,
    milestones: [1, 2, 3].map((number) => {
      const completedProjects = included.filter((project) => project.sectionCount > 0
        && project.sections.every((section) => section.milestones[number - 1]?.status === "Completado")
        && (number !== 3 || project.status === "Finalizado")).length;
      return { number, completedProjects, totalProjects: included.length, percent: percent(completedProjects, included.length) };
    }),
    totalSections: sections.length,
    completedSections,
    completedSectionMilestones: completedMilestones,
    totalSectionMilestones: sections.length * 3,
    sectionProgressPercent: percent(completedMilestones, sections.length * 3),
    videoDelivery: sumMetric("videoDelivery"),
    dropout: sumMetric("dropout"),
    projectsWithAllVideos: countProjects("videoDelivery", (value) => value.numerator === value.denominator),
    projectsWithDropout: countProjects("dropout", (value) => value.numerator > 0),
    projectDetails,
    projectsBySchool: [...projectsBySchool].map(([school, count]) => ({ school, ...ratio(count, included.length) }))
      .sort((left, right) => right.numerator - left.numerator || left.school.localeCompare(right.school, "es")),
    operationalSummary: {
      pendingSections: sections.length - completedSections,
      overdueSections: sections.filter((section) => section.overdue).length,
      completedTeacherFollowUps: teachers.filter((teacher) => teacher.status === "Finalizado").length,
      teacherFollowUps: teachers.length,
      readyProjects: included.filter((project) => project.readyForMilestoneTwo || project.readyForClosure).length,
    },
  };
}

function buildCampusComparisons(projects = [], studentRows = [], campus = "all", period = "") {
  const groups = new Map();
  const sectionsByProject = new Map();
  for (const project of projects) {
    if (project.status === "Cancelado") continue;
    const sectionCampuses = new Map();
    for (const section of project.sections) {
      const campusName = section.campusName || "Sin sede";
      if (campus !== "all" && campusName !== campus) continue;
      if (period && section.periodCode !== period) continue;
      if (!groups.has(campusName)) groups.set(campusName, {
        campusName, projects: new Set(), students: new Set(), participants: new Set(),
        totalSections: 0, completedSectionMilestones: 0,
      });
      const group = groups.get(campusName);
      sectionCampuses.set(key(section.id), group);
      group.projects.add(key(project.databaseId));
      group.totalSections += 1;
      group.completedSectionMilestones += section.milestones.filter((milestone) => milestone.status === "Completado").length;
    }
    sectionsByProject.set(key(project.databaseId), sectionCampuses);
  }
  for (const row of studentRows) {
    const group = sectionsByProject.get(key(row.projectId))?.get(key(row.sectionId));
    if (!group || !row.studentId) continue;
    group.students.add(key(row.studentId));
    if (row.teamId && row.assignmentStatus === "ASIGNADO") group.participants.add(key(row.studentId));
  }
  return [...groups.values()].sort((a, b) => a.campusName.localeCompare(b.campusName, "es")).map((group) => ({
    campusName: group.campusName,
    projectCount: group.projects.size,
    enrolledStudents: group.students.size,
    participatingStudents: group.participants.size,
    studentParticipationPercent: group.students.size ? percent(group.participants.size, group.students.size) : null,
    totalSections: group.totalSections,
    completedSectionMilestones: group.completedSectionMilestones,
    totalSectionMilestones: group.totalSections * 3,
    sectionProgressPercent: percent(group.completedSectionMilestones, group.totalSections * 3),
  }));
}

module.exports = { buildMonitoringIndicators, buildCampusComparisons };
