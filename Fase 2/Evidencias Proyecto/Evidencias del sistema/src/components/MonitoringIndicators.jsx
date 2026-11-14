import { BookOpenCheck, Building2, CheckCircle2, GraduationCap, MessageSquareText, Star, Users } from "lucide-react";
import "./monitoringIndicators.css";

const integer = (value) => new Intl.NumberFormat("es-CL").format(value);
const decimal = (value, digits = 1) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: digits }).format(value);
const count = (value, singular, plural) => `${integer(value)} ${value === 1 ? singular : plural}`;
const fraction = (metric) => metric.denominator ? `${integer(metric.numerator)} de ${integer(metric.denominator)}` : "Sin datos";

export default function MonitoringIndicators({ indicators, filters = {}, generatedAt, loading, stale }) {
  if (!indicators) return null;
  const data = indicators;
  const summary = data.operationalSummary;
  const updated = generatedAt ? new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", timeZone: "America/Santiago" }).format(new Date(generatedAt)) : "";
  const rating = data.averageProjectRating;
  const filtered = (filters.scope && filters.scope !== "all") || (filters.campus && filters.campus !== "all") || Boolean(filters.search || filters.period);
  const scopeLabel = { all: "Todos", attention: "Requieren atención", ready: "Listos para avanzar", finished: "Finalizados" }[filters.scope || "all"];
  return <section className="monitoring-overview" aria-labelledby="monitoring-overview-title" aria-busy={loading}>
    <header className="monitoring-overview__heading">
      <div><h2 id="monitoring-overview-title">Participación y avance</h2><p>{filtered ? "Vista filtrada" : "Portafolio completo"} · {count(data.projectCount, "proyecto", "proyectos")} · Sin proyectos cancelados</p>
        {filtered && <p className="monitoring-overview__scope">{filters.campus && filters.campus !== "all" ? filters.campus : "Todas las sedes"} · {scopeLabel}{filters.period ? ` · ${filters.period}` : ""}{filters.search ? ` · Búsqueda: ${filters.search}` : ""}</p>}
      </div>
      <span className="monitoring-overview__updated" role="status">{loading ? "Actualizando indicadores…" : `${stale ? "Últimos datos recibidos" : "Actualizado"}${updated ? ` · ${updated}` : ""}`}</span>
    </header>

    <dl className="monitoring-participation">
      <ParticipationMetric icon={GraduationCap} label="Estudiantes participantes" value={integer(data.participatingStudents)}
        detail={`${decimal(data.studentParticipationPercent)}% de ${count(data.enrolledStudents, "estudiante", "estudiantes")} en nómina`} featured />
      <ParticipationMetric icon={Users} label="Equipos conformados" value={integer(data.formedTeams)} detail="Con estudiantes vigentes asignados" />
      <ParticipationMetric icon={BookOpenCheck} label="Docentes participantes" value={integer(data.participatingTeachers)} detail="Docentes únicos con sección responsable" />
      <ParticipationMetric icon={Building2} label="Socios formadores vinculados" value={integer(data.linkedPartners)} detail="Organizaciones únicas con proyectos" />
    </dl>
    {data.videoDelivery && <dl className="monitoring-activity-summary">
      <div><dt>Equipos con video entregado</dt><dd>{fraction(data.videoDelivery)}{data.videoDelivery.percent !== null && <small>{decimal(data.videoDelivery.percent)}%</small>}</dd>
        {data.projectsWithAllVideos.denominator > 0 && <p>{fraction(data.projectsWithAllVideos)} proyectos con todas las entregas</p>}</div>
      <div><dt>Deserción por proyecto</dt><dd>{fraction(data.dropout)}{data.dropout.percent !== null && <small>{decimal(data.dropout.percent)}%</small>}</dd>
        {data.projectsWithDropout.denominator > 0 && <p>{fraction(data.projectsWithDropout)} proyectos con deserción</p>}</div>
    </dl>}

    <div className="monitoring-overview__body">
      <section className="monitoring-completion" aria-labelledby="monitoring-completion-title">
        <div className="monitoring-indicator-heading"><CheckCircle2 size={19} aria-hidden="true" /><h3 id="monitoring-completion-title">Avance de proyectos</h3></div>
        <p className="monitoring-indicator-note">Un hito termina cuando lo completan todas las secciones del proyecto.</p>
        <div className="monitoring-completion__stages">
          {data.milestones.map((milestone) => {
            const label = milestone.number === 3 ? "Proyectos finalizados" : `Proyectos con Hito ${milestone.number} terminado`;
            return <div className={`monitoring-stage monitoring-stage--${milestone.number}`} key={milestone.number}>
              <div><span>{label}</span><strong>{integer(milestone.completedProjects)}<small> / {integer(milestone.totalProjects)}</small></strong></div>
              <div className="monitoring-stage__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={milestone.percent}
                aria-valuetext={`${milestone.completedProjects} de ${milestone.totalProjects} proyectos, ${decimal(milestone.percent)}%`}><span style={{ width: `${milestone.percent}%` }} /></div>
              <span className="monitoring-stage__percentage">{decimal(milestone.percent)}%</span>
            </div>;
          })}
        </div>
        <div className="monitoring-section-progress"><div><strong>{decimal(data.sectionProgressPercent)}%</strong><span>Avance de hitos por sección</span></div>
          <p>{integer(data.completedSectionMilestones)} de {integer(data.totalSectionMilestones)} hitos completados · {integer(data.completedSections)} de {integer(data.totalSections)} secciones cerradas</p>
        </div>
      </section>

      <section className="monitoring-partner-feedback" aria-labelledby="monitoring-feedback-title">
        <div className="monitoring-indicator-heading"><MessageSquareText size={19} aria-hidden="true" /><h3 id="monitoring-feedback-title">Participación del socio formador</h3></div>
        <div className="monitoring-partner-feedback__response">
          <strong>{integer(data.respondingPartners)}<small> / {integer(data.partnersInvited)}</small></strong>
          <div><span>Socios que respondieron al Hito 2</span><small>{data.partnersInvited ? `${decimal(data.partnerResponsePercent)}% de los socios con revisión publicada` : "Aún no hay revisiones publicadas"}</small></div>
        </div>
        <p className="monitoring-indicator-note">Revisiones con respuestas: {integer(data.answeredReviewCount)} de {integer(data.reviewCount)}.</p>
        <div className="monitoring-project-rating">
          <div className="monitoring-project-rating__score"><Star size={22} aria-hidden="true" /><strong>{rating === null ? "—" : decimal(rating, 2)}</strong>{rating !== null && <span>/ 5</span>}</div>
          <div><h4>Valoración promedio de proyectos</h4><p>{rating === null ? "Sin evaluaciones todavía. La ausencia de respuestas no se cuenta como cero." : `${count(data.ratedProjects, "proyecto valorado", "proyectos valorados")} · ${count(data.ratingCount, "evaluación de equipo", "evaluaciones de equipos")}`}</p></div>
        </div>
      </section>
    </div>

    <dl className="monitoring-operational-summary" aria-label="Control operativo del portafolio">
      <div><dt>Secciones pendientes</dt><dd>{integer(summary.pendingSections)}<small>{summary.overdueSections ? `${integer(summary.overdueSections)} atrasadas` : "Sin atrasos con fecha límite"}</small></dd></div>
      <div><dt>Seguimientos docentes cerrados</dt><dd>{integer(summary.completedTeacherFollowUps)}<span> / {integer(summary.teacherFollowUps)}</span><small>Docente por proyecto</small></dd></div>
      <div><dt>Listos para avanzar</dt><dd>{integer(summary.readyProjects)}<small>Requieren acción o supervisión</small></dd></div>
    </dl>
    {data.projectsBySchool?.length > 0 && <details className="monitoring-indicator-definitions monitoring-metric-detail">
      <summary>Proyectos por escuela</summary>
      <ul className="monitoring-school-list">{data.projectsBySchool.map((row) => <li key={row.school}>
        <span>{row.school}</span><strong>{integer(row.numerator)} · {decimal(row.percent)}%</strong>
      </li>)}</ul>
    </details>}
    {data.projectDetails?.length > 0 && <details className="monitoring-indicator-definitions monitoring-metric-detail">
      <summary>Ver indicadores por proyecto</summary>
      <div className="monitoring-metric-detail__scroll" role="region" aria-label="Tabla de indicadores por proyecto" tabIndex={0}>
        <table>
          <caption>Proyectos en ejecución o finalizados. Se muestran las revisiones vigentes completadas por el socio. La valoración requiere tres evaluaciones por proyecto.</caption>
          <thead><tr>{["Código", "Escuela", "En equipo", "Hito 1", "Hito 2", "Secciones cerradas", "Videos", "Deserción", "Revisiones completadas", "Valoración"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.projectDetails.map((row) => <tr key={row.code}>
            <th scope="row">{row.code}</th><td>{row.school}</td><td>{fraction(row.participation)}</td>
            {row.milestones.map((milestone, index) => <td key={index}>{fraction(milestone)}</td>)}
            <td>{fraction(row.videoDelivery)}</td><td>{fraction(row.dropout)}</td><td>{fraction(row.partnerResponse)}</td>
            <td>{row.partnerRating === null ? count(row.evaluationCount, "evaluación", "evaluaciones") : `${decimal(row.partnerRating, 2)} / 5`}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>}
    <details className="monitoring-indicator-definitions"><summary>Cómo se calculan estos indicadores</summary>
      <ul>
        <li>Los estudiantes participantes tienen matrícula vigente, están activos y tienen equipo asignado. Cada estudiante, docente y socio se cuenta una sola vez, aunque participe en varios proyectos.</li>
        <li>La finalización exige el cierre del proyecto y de todas sus secciones. Las reaperturas actualizan el avance; los cierres parciales no completan el hito global.</li>
        <li>Las respuestas incluyen evaluaciones parciales y enlaces vencidos. Se usa la revisión vigente por sección o la que quedó registrada al cerrar Hito 2. Las revisiones revocadas sin uso en el cierre quedan excluidas.</li>
        <li>La valoración promedia primero las evaluaciones de cada proyecto y luego esos promedios. Cada proyecto tiene el mismo peso; los proyectos sin evaluación no entran en el promedio.</li>
        <li>Videos y deserción se calculan en proyectos en ejecución o finalizados. Se cuentan equipos con estudiantes asignados y entregas confirmadas. La deserción se mide sobre la matrícula vigente por proyecto. El desglose por escuela incluye los proyectos planificados.</li>
      </ul><p>Los filtros de sede, período, estado y búsqueda seleccionan proyectos. Los indicadores globales incluyen todas sus secciones. La exportación de la vista filtrada utiliza la misma selección.</p>
    </details>
  </section>;
}

function ParticipationMetric({ icon: Icon, label, value, detail, featured }) {
  return <div className={`monitoring-participation__metric${featured ? " is-featured" : ""}`}>
    <dt><Icon size={18} aria-hidden="true" />{label}</dt><dd>{value}<small>{detail}</small></dd>
  </div>;
}
