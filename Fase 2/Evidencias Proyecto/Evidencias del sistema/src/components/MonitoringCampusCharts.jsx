import "./monitoringCampusCharts.css";

const integer = (value) => new Intl.NumberFormat("es-CL").format(value);
const decimal = (value) => new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 }).format(value);

export default function MonitoringCampusCharts({ campuses, loading, stale }) {
  if (!Array.isArray(campuses)) return null;
  return <section className="monitoring-campus" aria-labelledby="monitoring-campus-title" aria-busy={loading}>
    <header className="monitoring-campus__heading">
      <div><h2 id="monitoring-campus-title">Comparación por sede</h2>
        <p>Participación y avance en las secciones de cada sede, según los filtros actuales. Sin proyectos cancelados.</p></div>
      <span>{campuses.length} {campuses.length === 1 ? "sede en esta selección" : "sedes en esta selección"}</span>
    </header>
    {stale && <p className="monitoring-campus__status" role="status">Últimos datos recibidos. No fue posible actualizar los gráficos.</p>}
    {!campuses.length ? <p className="monitoring-campus__empty">No hay sedes con proyectos para estos filtros.</p> : <>
      <div className="monitoring-campus__charts">
        <CampusChart campuses={campuses} type="participation" title="Participación estudiantil" description="Estudiantes con equipo asignado / estudiantes en nómina." />
        <CampusChart campuses={campuses} type="progress" title="Avance de hitos por sección" description="Hitos completados / total de hitos de las secciones." />
      </div>
      <p className="monitoring-campus__note">Cada sede cuenta sus estudiantes una sola vez. Una persona o un proyecto puede aparecer en varias sedes; sus totales no se suman. El avance por sede mide sus secciones; los hitos globales del proyecto requieren todas sus secciones.</p>
      <details className="monitoring-campus__details"><summary>Ver cifras por sede</summary>
        <div className="monitoring-campus__table-scroll" tabIndex={0} role="region" aria-label="Tabla de cifras por sede">
          <table><caption>Detalle de la selección actual por sede</caption>
            <thead><tr><th scope="col">Sede</th><th scope="col">Proyectos</th><th scope="col">Estudiantes con equipo / nómina</th><th scope="col">Participación</th><th scope="col">Hitos completados / total</th><th scope="col">Avance</th></tr></thead>
            <tbody>{campuses.map((row) => <tr key={row.campusName}><th scope="row">{row.campusName}</th><td>{integer(row.projectCount)}</td><td>{integer(row.participatingStudents)} / {integer(row.enrolledStudents)}</td><td>{row.studentParticipationPercent === null ? "Sin matrícula" : `${decimal(row.studentParticipationPercent)}%`}</td><td>{integer(row.completedSectionMilestones)} / {integer(row.totalSectionMilestones)}</td><td>{decimal(row.sectionProgressPercent)}%</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </>}
  </section>;
}

function CampusChart({ campuses, type, title, description }) {
  const participation = type === "participation";
  return <figure className={`monitoring-campus-chart monitoring-campus-chart--${type}`}>
    <figcaption><h3>{title}</h3><p>{description}</p></figcaption>
    <div className="monitoring-campus-chart__axis" aria-hidden="true">{[0, 25, 50, 75, 100].map((tick) => <span key={tick}>{tick}%</span>)}</div>
    <ul>{campuses.map((row) => {
      const value = participation ? row.studentParticipationPercent : row.sectionProgressPercent;
      const detail = participation ? `${integer(row.participatingStudents)} de ${integer(row.enrolledStudents)} estudiantes` : `${integer(row.completedSectionMilestones)} de ${integer(row.totalSectionMilestones)} hitos`;
      return <li key={row.campusName}>
        <div className="monitoring-campus-chart__label"><span>{row.campusName}</span><strong>{value === null ? "—" : `${decimal(value)}%`}</strong></div>
        {value === null ? <div className="monitoring-campus-chart__no-data">Sin matrícula para calcular participación</div> : <>
          <div className="monitoring-campus-chart__track" role="progressbar" aria-label={`${title} en ${row.campusName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${detail}, ${decimal(value)}%`}><span style={{ width: `${value}%` }} /></div>
          <small>{detail}</small>
        </>}
      </li>;
    })}</ul>
  </figure>;
}
