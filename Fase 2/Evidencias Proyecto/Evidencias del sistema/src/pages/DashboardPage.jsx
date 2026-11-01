import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Plus,
  School,
  Users,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Card, EmptyState, MetricCard, PageHeader, StatusBadge } from "../components/UI";
import { useApp } from "../context/AppContext";

export default function DashboardPage() {
  const { session, partners, visibleProjects, catalogs, loadingData, dataSource } = useApp();
  const location = useLocation();
  if (session.role === "admin") return <AdminDashboard partners={partners} projects={visibleProjects} catalogs={catalogs} loadingData={loadingData} dataSource={dataSource} deletionNotice={location.state} />;
  if (session.role === "teacher") return <TeacherDashboard projects={visibleProjects} catalogs={catalogs} partners={partners} />;
  return <CoordinatorDashboard session={session} partners={partners} projects={visibleProjects} catalogs={catalogs} />;
}

function AdminDashboard({ partners, projects, catalogs, loadingData, dataSource, deletionNotice }) {
  return (
    <>
      <PageHeader
        eyebrow="Administración"
        title="Base académica del piloto"
        description="Prepara usuarios, asignaturas, secciones y nóminas antes de iniciar la operación con datos reales."
        actions={<Link to="/app/carga-academica"><Button icon={Database}>Revisar carga académica</Button></Link>}
      />
      {deletionNotice?.deletedProject && <div className={`notice-banner ${deletionNotice.cleanupWarning ? "notice-banner--error" : "notice-banner--success"}`} role="status"><CheckCircle2 size={20} /><div><strong>Proyecto eliminado</strong><p>El proyecto {deletionNotice.deletedProject} fue eliminado definitivamente.{deletionNotice.cleanupWarning ? ` ${deletionNotice.cleanupWarning}` : ""}</p></div></div>}
      <div className="metrics-grid">
        <MetricCard icon={BookOpen} label="Asignaturas" value={catalogs.subjects.length} detail={dataSource === "api" ? "Catálogo real" : "Catálogo inicial"} />
        <MetricCard icon={School} label="Secciones" value={catalogs.sections.length} detail="Distribuidas por sede" tone="blue" />
        <MetricCard icon={Building2} label="Socios formadores" value={partners.length} detail="Disponibles globalmente" tone="green" />
        <MetricCard icon={ClipboardList} label="Proyectos" value={projects.length} detail="Ciclo 2026" tone="purple" />
      </div>
      <ProjectTable projects={projects} catalogs={catalogs} partners={partners} adminView />
      <Card className="panel-card">
        <div className="card-heading">
          <div><p className="eyebrow">Preparación</p><h2>Estado de la configuración</h2></div>
        </div>
        <div className="readiness-list">
          <ReadinessItem title="Sedes" detail={`${catalogs.campuses.length} sedes disponibles`} done={dataSource === "api"} />
          <ReadinessItem title="Asignaturas y secciones" detail={`${catalogs.subjects.length} asignaturas y ${catalogs.sections.length} secciones`} done={dataSource === "api"} />
          <ReadinessItem title="Nómina de estudiantes" detail={`${catalogs.studentCount} estudiantes cargados`} done={dataSource === "api"} />
          <ReadinessItem title="Conexión operativa" detail={loadingData ? "Consultando la API" : dataSource === "api" ? "Azure SQL disponible" : "Modo demostración"} done={dataSource === "api"} />
        </div>
      </Card>
    </>
  );
}

function CoordinatorDashboard({ session, partners, projects, catalogs }) {
  const navigate = useNavigate();
  const active = projects.filter((project) => project.status === "En ejecución").length;
  const finished = projects.filter((project) => project.status === "Finalizado").length;
  return (
    <>
      <PageHeader
        eyebrow={session.title}
        title={`Hola, ${session.name.split(" ")[0]}`}
        description="Crea propuestas en nombre de los socios formadores y vincúlalas con la oferta académica disponible."
        actions={<Button icon={Plus} onClick={() => navigate("/app/propuestas/nueva")}>Nueva propuesta</Button>}
      />
      <div className="metrics-grid metrics-grid--three">
        <MetricCard icon={ClipboardList} label="Proyectos 2026" value={projects.length} detail="Todos los estados" />
        <MetricCard icon={CalendarDays} label="En ejecución" value={active} detail="Con seguimiento docente" tone="blue" />
        <MetricCard icon={Building2} label="Socios disponibles" value={partners.length} detail="Catálogo compartido" tone="green" />
      </div>
      <ProjectTable projects={projects} catalogs={catalogs} partners={partners} />
      {finished > 0 && <p className="sr-only">{finished} proyectos finalizados.</p>}
    </>
  );
}

export function TeacherDashboard({ projects, catalogs, partners, coordinatorMode = false }) {
  const active = projects.filter((project) => getTeachingDisplayStatus(project) === "En ejecución").length;
  const closed = projects.filter((project) => getTeachingDisplayStatus(project) === "Cerrado").length;
  const completedMilestones = projects.reduce((total, project) => total + countTeachingMilestones(project), 0);
  return (
    <>
      <PageHeader
        eyebrow={coordinatorMode ? "Faceta docente" : "Panel docente"}
        title="Mis proyectos vinculados"
        description={coordinatorMode
          ? "Estos proyectos corresponden exclusivamente a las secciones que tienes a tu cargo como docente."
          : "Aquí aparecen únicamente los proyectos asociados a las secciones que impartes durante el período."}
      />
      <div className="metrics-grid">
        <MetricCard icon={ClipboardList} label="Proyectos asignados" value={projects.length} detail="Según tus secciones" />
        <MetricCard icon={CalendarDays} label="En ejecución" value={active} detail="Con actividad vigente" tone="blue" />
        <MetricCard icon={CheckCircle2} label="Cerrados" value={closed} detail="Seguimiento propio terminado" tone="green" />
        <MetricCard icon={CheckCircle2} label="Hitos completados" value={completedMilestones} detail="Durante el período" tone="green" />
      </div>
      {projects.length ? <ProjectTable projects={projects} catalogs={catalogs} partners={partners} teachingView /> : <EmptyState title="Aún no tienes proyectos asignados" description="Cuando una de tus secciones sea seleccionada como responsable, el proyecto aparecerá en esta vista." />}
    </>
  );
}

function ProjectTable({ projects, catalogs, partners = [], teachingView = false, adminView = false }) {
  const subjectsById = new Map(catalogs.subjects.map((subject) => [subject.id, subject]));
  const partnersById = new Map(partners.map((partner) => [partner.id, partner]));
  const campusesById = new Map(catalogs.campuses.map((campus) => [campus.id, campus]));
  return (
    <Card className="panel-card table-card">
      <div className="card-heading">
        <div><p className="eyebrow">Portafolio</p><h2>{adminView ? "Proyectos y responsables" : "Proyectos recientes"}</h2></div>
        <span className="record-count">{projects.length} registros</span>
      </div>
      <div className="responsive-table portfolio-table">
        <table>
          <thead><tr><th>Proyecto</th><th>Socio formador</th><th>{adminView ? "Creado por" : "Coordinador CITT"}</th><th>Asignatura</th>{adminView && <th>Sedes</th>}<th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td><strong>{project.name}</strong><small>{project.id}</small></td>
                <td><strong>{partnersById.get(project.partnerId)?.businessName || "Sin información"}</strong></td>
                <td><strong>{project.coordinatorName || "Por identificar"}</strong>{project.coordinatorTitle && <small>{project.coordinatorTitle}</small>}</td>
                <td>{subjectsById.get(project.subjectId)?.name}<small>{subjectsById.get(project.subjectId)?.code || project.subjectId}</small></td>
                {adminView && <td>{project.campusIds?.map((campusId) => campusesById.get(campusId)?.name || campusId).join(", ") || "Sin sedes"}</td>}
                <td><StatusBadge status={teachingView ? getTeachingDisplayStatus(project) : project.status} /></td>
                <td><Link className="table-action" to={`/app/proyectos/${project.id}`}>Ver <ArrowRight size={16} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function getTeachingDisplayStatus(project) {
  return project.teachingStatus || project.status;
}

function countTeachingMilestones(project) {
  if (!project.teachingSectionIds?.length) return 0;
  if (!project.sectionStates?.length) return project.milestones?.filter((milestone) => milestone.status === "Completado").length || 0;
  const assigned = new Set(project.teachingSectionIds);
  return project.sectionStates
    .filter((section) => assigned.has(section.sectionId))
    .reduce((total, section) => total + section.milestones.filter((milestone) => milestone.status === "Completado").length, 0);
}

function ReadinessItem({ title, detail, done = false }) {
  return (
    <div className="readiness-item">
      <span className={done ? "is-done" : ""}>{done ? <CheckCircle2 size={19} /> : <Users size={19} />}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <b>{done ? "Disponible" : "Pendiente"}</b>
    </div>
  );
}
