import { Check, ChevronRight, CircleAlert, Search } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Button({ children, variant = "primary", icon: Icon, className = "", ...props }) {
  return (
    <button className={`button button--${variant} ${className}`} {...props}>
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
}

export function Card({ children, className = "", ...props }) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function Field({ label, hint, required, children, className = "" }) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}{required && <b aria-hidden="true"> *</b>}</span>
      {hint && <span className="field__hint">{hint}</span>}
      {children}
    </label>
  );
}

export function Input(props) {
  return <input className="control" {...props} />;
}

export function Select({ children, ...props }) {
  return <select className="control" {...props}>{children}</select>;
}

export function Textarea(props) {
  return <textarea className="control control--textarea" {...props} />;
}

export function StatusBadge({ status }) {
  const className = status.toLowerCase().replaceAll(" ", "-").replaceAll("ó", "o");
  return <span className={`status status--${className}`}><span />{status}</span>;
}

export function MetricCard({ icon: Icon, label, value, detail, tone = "yellow" }) {
  return (
    <Card className="metric-card">
      <span className={`metric-card__icon metric-card__icon--${tone}`}><Icon size={22} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </Card>
  );
}

export function SearchInput({ value, onChange, placeholder = "Buscar" }) {
  return (
    <div className="search-control">
      <Search size={18} />
      <input value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

export function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <CircleAlert size={26} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function Stepper({ current = 1 }) {
  const labels = ["Socio formador", "Descripción", "Vinculación académica", "Revisión"];
  return (
    <ol className="stepper">
      {labels.map((label, index) => {
        const number = index + 1;
        const complete = number < current;
        return (
          <li key={label} className={number <= current ? "is-active" : ""}>
            <span>{complete ? <Check size={16} /> : number}</span>
            <small>{label}</small>
            {number < labels.length && <ChevronRight size={16} />}
          </li>
        );
      })}
    </ol>
  );
}
