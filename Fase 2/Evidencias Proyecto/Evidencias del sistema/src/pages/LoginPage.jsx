import { Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";

export default function LoginPage() {
  const { session, sessionLoading, login } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showConnectionMessage, setShowConnectionMessage] = useState(false);
  const [error, setError] = useState("");
  const pendingRequest = useRef(null);

  useEffect(() => () => pendingRequest.current?.abort(), []);

  useEffect(() => {
    if (!connecting) return;
    const timer = setTimeout(() => setShowConnectionMessage(true), 15_000);
    return () => clearTimeout(timer);
  }, [connecting]);

  if (!sessionLoading && session) return <Navigate to="/app" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pendingRequest.current || sessionLoading) return;
    const controller = new AbortController();
    pendingRequest.current = controller;
    setError("");
    setSubmitting(true);
    setShowConnectionMessage(false);
    setConnecting(true);
    try {
      await login(email, password, {
        signal: controller.signal,
        onAuthenticating: () => setConnecting(false),
      });
      navigate("/app");
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.message);
    } finally {
      pendingRequest.current = null;
      if (!controller.signal.aborted) {
        setSubmitting(false);
        setConnecting(false);
      }
    }
  };

  return (
    <main className="login-page">
      <section className="login-hero">
        <img className="login-brand" src="/brand/citt-duocuc-white.png" alt="CITT Duoc UC" />
        <div className="login-hero__content">
          <p className="eyebrow eyebrow--light">Vinculación con el Medio</p>
          <h1>Proyectos que conectan el aula con desafíos reales.</h1>
          <p>Una plataforma simple para coordinar socios formadores, vincular asignaturas y acompañar el trabajo de docentes y estudiantes.</p>
          <div className="login-feature">
            <UsersRound size={22} />
            <div><strong>Sistema Gestor de Proyectos de Asignaturas</strong><span>Un acceso propio y seguro para cada integrante del piloto.</span></div>
          </div>
        </div>
        <small>Duoc UC · Piloto VCM 2026</small>
      </section>

      <section className="login-panel">
        <div className="login-panel__inner">
          <span className="login-lock"><LockKeyhole size={24} /></span>
          <p className="eyebrow">Acceso al piloto</p>
          <h2>Inicia sesión</h2>
          <p className="login-panel__description">Usa una cuenta ficticia de README.md. Contraseña de pruebas: LocalVCM2026!</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="field">
              <label className="field__label" htmlFor="login-email">Correo electrónico</label>
              <input id="login-email" className="control login-control" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.test" required autoFocus disabled={submitting} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="login-password">Contraseña</label>
              <span className="password-control">
                <input id="login-password" className="control login-control" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            {connecting && showConnectionMessage && <p className="login-connection" role="status">Estamos conectando al sistema</p>}
            <button className="button button--primary login-submit" type="submit" disabled={submitting || sessionLoading} aria-busy={submitting}>
              {submitting ? <LoaderCircle size={18} /> : <LogIn size={18} />}
              {submitting ? "Ingresando..." : "Ingresar"}
            </button>
          </form>

          <p className="prototype-note">El acceso es exclusivo para participantes autorizados del piloto.</p>
        </div>
      </section>
    </main>
  );
}
