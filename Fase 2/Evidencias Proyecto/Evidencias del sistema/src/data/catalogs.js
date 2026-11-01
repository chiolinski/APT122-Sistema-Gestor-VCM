// La carga sintética oficial vive en fixtures/academic-local.json y SQL local.
export const campuses = [];
export const subjects = [];
export const sections = [];
export const initialPartners = [];
export const initialStudents = [];
export const initialProjects = [];
export function getSubject(id) { return subjects.find((row) => row.id === id); }
export function getCampus(id) { return campuses.find((row) => row.id === id); }
export function getSection(id) { return sections.find((row) => row.id === id); }
