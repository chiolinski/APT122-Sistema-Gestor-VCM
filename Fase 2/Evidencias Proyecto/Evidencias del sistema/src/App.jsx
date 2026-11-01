import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./context/AppContext";
import AppShell from "./components/AppShell";
import AcademicDataPage from "./pages/AcademicDataPage";
import AcademicManagementPage from "./pages/AcademicManagementPage";
import AccountPage from "./pages/AccountPage";
import CoordinationMonitoringPage from "./pages/CoordinationMonitoringPage";
import ControlCenterPage from "./pages/ControlCenterPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import PartnersPage from "./pages/PartnersPage";
import PartnerReviewPage from "./pages/PartnerReviewPage";
import StudentVideoDeliveryPage from "./pages/StudentVideoDeliveryPage";
import PilotReportsPage from "./pages/PilotReportsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProposalFormPage from "./pages/ProposalFormPage";
import TeachingProjectsPage from "./pages/TeachingProjectsPage";
import UsersPage from "./pages/UsersPage";

function SessionLoader() {
  return <div className="session-loader" role="status">Validando sesión...</div>;
}

function ProtectedLayout() {
  const { session, sessionLoading } = useApp();
  if (sessionLoading) return <SessionLoader />;
  return session ? <AppShell /> : <Navigate to="/login" replace />;
}

function RoleRoute({ roles, children }) {
  const { session } = useApp();
  return roles.includes(session?.role) ? children : <Navigate to="/app" replace />;
}

function TeachingRoute({ children }) {
  const { session } = useApp();
  return session?.canTeach ? children : <Navigate to="/app" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/revision-socio" element={<PartnerReviewPage />} />
      <Route path="/entrega-video" element={<StudentVideoDeliveryPage />} />
      <Route path="/app" element={<ProtectedLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="mi-cuenta" element={<AccountPage />} />
        <Route path="proyectos/:projectId" element={<ProjectDetailPage />} />
        <Route
          path="mis-proyectos"
          element={<TeachingRoute><TeachingProjectsPage /></TeachingRoute>}
        />
        <Route
          path="propuestas/nueva"
          element={<RoleRoute roles={["coordinator"]}><ProposalFormPage /></RoleRoute>}
        />
        <Route
          path="socios"
          element={<RoleRoute roles={["admin", "coordinator"]}><PartnersPage /></RoleRoute>}
        />
        <Route
          path="seguimiento"
          element={<RoleRoute roles={["admin", "coordinator"]}><CoordinationMonitoringPage /></RoleRoute>}
        />
        <Route
          path="control"
          element={<RoleRoute roles={["admin", "coordinator"]}><ControlCenterPage /></RoleRoute>}
        />
        <Route
          path="carga-academica"
          element={<RoleRoute roles={["admin"]}><AcademicDataPage /></RoleRoute>}
        />
        <Route
          path="usuarios"
          element={<RoleRoute roles={["admin"]}><UsersPage /></RoleRoute>}
        />
        <Route
          path="ajustes-academicos"
          element={<RoleRoute roles={["admin"]}><AcademicManagementPage /></RoleRoute>}
        />
        <Route
          path="reportes"
          element={<RoleRoute roles={["admin"]}><PilotReportsPage /></RoleRoute>}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
