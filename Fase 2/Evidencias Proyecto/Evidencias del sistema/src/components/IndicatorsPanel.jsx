import { Handshake, ListChecks, Route, School, Star, Users } from "lucide-react";
import { Card } from "./UI";
import "./indicatorsPanel.css";

const EMPTY = "Sin datos aún";

export default function IndicatorsPanel({ indicators }) {
  const steps = [
    { label: "Paso 1 · Hito 1", summary: indicators.milestoneFunnel[0], noun: "secciones listas" },
    { label: "Paso 2 · Hito 2", summary: indicators.milestoneFunnel[1], noun: "secciones listas" },
    { label: "Paso 3 · Finalizado", summary: indicators.closure, noun: "secciones cerradas" },
  ];
  const activeProjects = indicators.projects.length;
  const portfolio = indicators.projectsBySchool.total;

  return (
    <Card className="indicators-panel" aria-labelledby="indicators-panel-title">
      <header className="indicators-panel__header">
        <div>
          <p className="eyebrow">Indicadores VcM {indicators.period || ""}</p>
          <h2 id="indicators-panel-title">Participación y avance</h2>
        </div>
        <span>{activeProjects} de {projectsText(portfolio)} del período en ejecución o finalizados</span>
      </header>

      <section className="indicators-panel__block" aria-labelledby="indicators-progress-title">
        <h3 id="indicators-progress-title"><Route size={16} /> ¿Cómo avanzan los proyectos?</h3>
        <div className="indicators-steps">
          {steps.map((step) => (
            <div key={step.label} className="indicators-step">
              <small>{step.label}</small>
              <ProjectCount metric={step.summary.projects} />
              <Progress metric={step.summary.projects} />
              <p>{countText(step.summary.detail, step.noun)}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="indicators-panel__columns">
        <section className="indicators-panel__block" aria-labelledby="indicators-students-title">
          <h3 id="indicators-students-title"><Users size={16} /> Estudiantes y equipos</h3>
          <div className="indicators-box">
            <IndicatorRow label="En un equipo" summary={indicators.participation} note="con todos en equipo" />
            <IndicatorRow label="Equipos con video" summary={indicators.videoDelivery} note="con todos los videos" />
            <IndicatorRow label="Deserción" summary={indicators.dropout} note="con desertores" tone="warning" />
          </div>
        </section>

        <section className="indicators-panel__block" aria-labelledby="indicators-partner-title">
          <h3 id="indicators-partner-title"><Handshake size={16} /> Socio formador</h3>
          <div className="indicators-box">
            <div className="indicators-partner">
              <small>Respondió la revisión del Hito 2</small>
              <ProjectCount metric={indicators.partnerResponse.projects} />
              <p>{countText(indicators.partnerResponse.detail, "revisiones respondidas")}</p>
            </div>
            <div className="indicators-partner">
              <small>Valoración promedio</small>
              <Rating rating={indicators.partnerRating} />
              <p>{indicators.partnerRating.sufficient
                ? `${indicators.partnerRating.count} evaluaciones de equipos · ${projectsText(indicators.partnerRating.projects)}`
                : "Se necesitan al menos 3 evaluaciones"}</p>
            </div>
          </div>
        </section>
      </div>

      <section className="indicators-panel__block" aria-labelledby="indicators-projects-title">
        <h3 id="indicators-projects-title"><ListChecks size={16} /> Detalle por proyecto</h3>
        {activeProjects === 0 ? (
          <p className="indicators-panel__empty">No hay proyectos en ejecución en este período.</p>
        ) : (
          <div className="indicators-table">
            <table>
              <thead>
                <tr><th>Proyecto</th><th>En equipo</th><th>Hito 1</th><th>Hito 2</th><th>Finalizado</th><th>Videos</th><th>Deserción</th><th>Socio</th><th>Valoración</th></tr>
              </thead>
              <tbody>
                {indicators.projects.map((project) => (
                  <tr key={project.code}>
                    <td><strong>{project.code}</strong><small>{project.name} · {project.school}</small></td>
                    <FractionCell metric={project.participation} />
                    {project.milestones.map((step) => <FractionCell key={step.milestone} metric={step} />)}
                    <FractionCell metric={project.closure} />
                    <FractionCell metric={project.videoDelivery} />
                    <FractionCell metric={project.dropout} tone="warning" />
                    <FractionCell metric={project.partnerResponse} />
                    <td>{project.partnerRating.sufficient ? formatAverage(project.partnerRating.average) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="indicators-panel__block" aria-labelledby="indicators-schools-title">
        <h3 id="indicators-schools-title"><School size={16} /> Proyectos por escuela <span>incluye planificados</span></h3>
        {portfolio === 0 ? (
          <p className="indicators-panel__empty">No hay proyectos en este período.</p>
        ) : (
          <div className="indicators-schools">
            {indicators.projectsBySchool.schools.map((item) => (
              <div key={item.school}>
                <div className="indicators-row__label"><span>{item.school}</span><strong>{item.numerator} · {item.percent} %</strong></div>
                <Progress metric={item} tone="school" />
              </div>
            ))}
          </div>
        )}
      </section>

      <details className="indicators-panel__help">
        <summary>Cómo se calculan estos indicadores</summary>
        <ul>
          <li>Solo cuentan los proyectos en ejecución o finalizados del período. Los planificados aparecen únicamente en “Proyectos por escuela”.</li>
          <li>Un proyecto completa un hito cuando todas sus secciones lo terminaron, y queda finalizado cuando todas sus secciones están cerradas.</li>
          <li>Los estudiantes se cuentan dentro de cada proyecto: quien participa en dos proyectos de asignaturas distintas cuenta en ambos.</li>
          <li>“En un equipo” no considera a los desertores. La deserción se calcula sobre toda la matrícula vigente del proyecto.</li>
          <li>La respuesta del socio considera las revisiones vigentes que el propio socio completó, sin cierres internos.</li>
          <li>La valoración promedio se muestra con al menos 3 evaluaciones.</li>
        </ul>
      </details>
    </Card>
  );
}

function ProjectCount({ metric }) {
  if (!metric.evaluable) return <strong className="indicators-count is-empty">{EMPTY}</strong>;
  return <strong className="indicators-count">{metric.numerator} <span>de {projectsText(metric.denominator)}</span></strong>;
}

function IndicatorRow({ label, summary, note, tone }) {
  const { detail, projects } = summary;
  return (
    <div className={`indicators-row ${tone ? `indicators-row--${tone}` : ""}`}>
      <div className="indicators-row__label">
        <span>{label}</span>
        <strong>{detail.evaluable ? `${detail.numerator} de ${detail.denominator} · ${detail.percent} %` : EMPTY}</strong>
      </div>
      <Progress metric={detail} tone={tone} />
      {projects.evaluable && <small>{projects.numerator} de {projectsText(projects.denominator)} {note}</small>}
    </div>
  );
}

function Progress({ metric, tone }) {
  const percent = metric.evaluable ? metric.percent : 0;
  return (
    <div className={`indicators-progress ${tone ? `indicators-progress--${tone}` : ""}`} role="progressbar"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

function Rating({ rating }) {
  if (!rating.sufficient) return <strong className="indicators-count is-empty">Muestra insuficiente</strong>;
  const filled = Math.round(rating.average);
  return (
    <strong className="indicators-count">
      {formatAverage(rating.average)} <span>/ 5</span>
      <span className="indicators-stars" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((star) => <Star key={star} size={15} className={star <= filled ? "is-filled" : ""} />)}
      </span>
    </strong>
  );
}

function FractionCell({ metric, tone }) {
  if (!metric.evaluable) return <td className="is-empty">—</td>;
  const complete = tone !== "warning" && metric.numerator === metric.denominator;
  return <td className={complete ? "is-complete" : ""}>{metric.numerator}/{metric.denominator}</td>;
}

function countText(metric, noun) {
  return metric.evaluable ? `${metric.numerator} de ${metric.denominator} ${noun}` : EMPTY;
}

function projectsText(count) {
  return `${count} ${count === 1 ? "proyecto" : "proyectos"}`;
}

function formatAverage(value) {
  return value.toFixed(1).replace(".", ",");
}
