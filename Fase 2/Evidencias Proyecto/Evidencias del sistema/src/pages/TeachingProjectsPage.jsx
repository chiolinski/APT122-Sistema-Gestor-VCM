import { TeacherDashboard } from "./DashboardPage";
import { useApp } from "../context/AppContext";

export default function TeachingProjectsPage() {
  const { teachingProjects, catalogs, partners } = useApp();
  return <TeacherDashboard projects={teachingProjects} catalogs={catalogs} partners={partners} coordinatorMode />;
}
