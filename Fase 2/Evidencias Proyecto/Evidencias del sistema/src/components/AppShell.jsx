import {
  AlertTriangle,
  Activity,
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  Database,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/controlCenterApi";

function navigationFor(session) {
  const { role, canTeach } = session;
  const common = [
    { to: "/app", label: "Inicio", icon: LayoutDashboard, end: true },
    { to: "/app/mi-cuenta", label: "Mi cuenta", icon: KeyRound },
  ];
  if (role === "admin") {
    return [
      ...common,
      { to: "/app/usuarios", label: "Usuarios", icon: Users },
      { to: "/app/carga-academica", label: "Carga académica", icon: Database },
      { to: "/app/reportes", label: "Reportes", icon: BarChart3 },
      { to: "/app/seguimiento", label: "Seguimiento", icon: Activity },
      { to: "/app/control", label: "Control", icon: ShieldCheck },
      { to: "/app/socios", label: "Socios formadores", icon: Building2 },
    ];
  }
  if (role === "coordinator") {
    return [
      ...common,
      ...(canTeach ? [{ to: "/app/mis-proyectos", label: "Mis proyectos docentes", icon: ClipboardList }] : []),
      { to: "/app/seguimiento", label: "Seguimiento", icon: Activity },
      { to: "/app/control", label: "Control", icon: ShieldCheck },
      { to: "/app/propuestas/nueva", label: "Nueva propuesta", icon: Plus },
      { to: "/app/socios", label: "Socios formadores", icon: Building2 },
    ];
  }
  return [...common, { to: "/app", label: "Mis proyectos", icon: ClipboardList, end: true }];
}

export default function AppShell() {
  const { session, logout, dataError } = useApp();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationSummaryVisible, setNotificationSummaryVisible] = useState(false);
  const [notificationState, setNotificationState] = useState({ records: [], unreadCount: 0, readStateEnabled: true });
  const [notificationError, setNotificationError] = useState("");
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const notificationRef = useRef(null);
  const summaryInitialized = useRef(false);
  const navigation = navigationFor(session);

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const next = await getNotifications();
      setNotificationState(next);
      setNotificationError("");
      if (!summaryInitialized.current) {
        summaryInitialized.current = true;
        setNotificationSummaryVisible(next.unreadCount > 0);
      }
    } catch (error) {
      setNotificationError(error.message);
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => { refreshNotifications(); }, [refreshNotifications, session.id]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !notificationRef.current?.contains(event.target))) setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const openNotifications = () => {
    if (!notificationsOpen) refreshNotifications();
    setNotificationsOpen(!notificationsOpen);
    setNotificationSummaryVisible(false);
  };

  const selectNotification = async (notification) => {
    if (!notification.read && notificationState.readStateEnabled) {
      try {
        await markNotificationRead(notification.key);
        setNotificationState((current) => ({
          ...current,
          unreadCount: Math.max(0, current.unreadCount - 1),
          records: current.records.map((item) => item.key === notification.key ? { ...item, read: true } : item),
        }));
      } catch (error) { setNotificationError(error.message); }
    }
    setNotificationsOpen(false);
    if (notification.actionUrl) navigate(notification.actionUrl);
  };

  const readAllNotifications = async () => {
    try {
      await markAllNotificationsRead();
      setNotificationState((current) => ({ ...current, unreadCount: 0, records: current.records.map((item) => ({ ...item, read: true })) }));
      setNotificationError("");
    } catch (error) { setNotificationError(error.message); }
  };

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink to="/app" className="brand" aria-label="Sistema Gestor de Proyectos de Asignaturas">
            <img className="brand__logo" src="/brand/citt-duocuc-color.png" alt="CITT Duoc UC" />
            <span className="brand__divider" />
            <span className="brand__product">VCM <strong>2026</strong></span>
          </NavLink>

          <nav className="desktop-nav" aria-label="Navegación principal">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={`${to}-${label}`} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}>
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="user-area">
            <div className="notification-center" ref={notificationRef}>
              <button className={`icon-button notification-button ${notificationsOpen ? "is-active" : ""}`} onClick={openNotifications} aria-label={`Notificaciones${notificationState.unreadCount ? `, ${notificationState.unreadCount} sin leer` : ""}`} title="Notificaciones" aria-expanded={notificationsOpen}>
                <Bell size={19} />
                {notificationState.unreadCount > 0 && <span>{notificationState.unreadCount > 99 ? "99+" : notificationState.unreadCount}</span>}
              </button>
              {notificationsOpen && <div className="notification-popover" role="dialog" aria-label="Notificaciones internas">
                <div className="notification-popover__heading"><div><strong>Notificaciones</strong><small>{notificationState.unreadCount ? `${notificationState.unreadCount} sin leer` : "Todo al día"}</small></div>{notificationState.unreadCount > 0 && notificationState.readStateEnabled && <button type="button" onClick={readAllNotifications}><CheckCheck size={15} /> Marcar leídas</button>}</div>
                {notificationError && <p className="notification-popover__error">{notificationError}</p>}
                {!notificationState.readStateEnabled && <p className="notification-popover__note">Los avisos están disponibles; su estado de lectura se habilitará con la migración 008.</p>}
                <div className="notification-list">
                  {notificationState.records.map((notification) => <button type="button" className={`notification-item notification-item--${notification.tone} ${notification.read ? "is-read" : ""}`} key={notification.key} onClick={() => selectNotification(notification)}>
                    <span className="notification-item__marker" />
                    <span><strong>{notification.title}</strong><small>{notification.message}</small></span>
                  </button>)}
                  {!notificationsLoading && !notificationState.records.length && <div className="notification-empty"><CheckCheck size={22} /><strong>Todo al día</strong><small>No hay tareas ni alertas pendientes para tu perfil.</small></div>}
                  {notificationsLoading && <div className="notification-empty"><span className="notification-loader" /><small>Actualizando avisos...</small></div>}
                </div>
              </div>}
            </div>
            <div className="user-chip">
              <span className="avatar">{session.initials}</span>
              <span className="user-chip__copy">
                <strong>{session.name}</strong>
                <small>{session.title}</small>
              </span>
              <ChevronDown size={16} />
            </div>
            <button className="icon-button logout-button" onClick={handleLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={19} />
            </button>
            <button className="icon-button mobile-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Abrir menú">
              {menuOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="mobile-nav" aria-label="Navegación móvil">
            {navigation.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={`${to}-${label}`} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link ${isActive ? "is-active" : ""}`}>
                <Icon size={17} />
                {label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <div className="environment-strip">
        <div><BookOpenCheck size={15} /> Sistema Gestor de Proyectos de Asignaturas</div>
        <span>Ambiente de prototipo</span>
      </div>

      <main className="page-container">
        {notificationSummaryVisible && notificationState.unreadCount > 0 && (
          <div className="notification-summary" role="status">
            <Bell size={20} />
            <div><strong>Tienes {notificationState.unreadCount} {notificationState.unreadCount === 1 ? "notificación pendiente" : "notificaciones pendientes"}</strong><p>Revisa tus tareas y alertas operativas desde la campana superior.</p></div>
            <button type="button" onClick={() => { setNotificationSummaryVisible(false); setNotificationsOpen(true); }}>Revisar</button>
            <button type="button" className="notification-summary__close" onClick={() => setNotificationSummaryVisible(false)} aria-label="Cerrar aviso"><X size={17} /></button>
          </div>
        )}
        {dataError && (
          <div className="notice-banner notice-banner--error" role="alert">
            <AlertTriangle size={20} />
            <div><strong>Datos no disponibles</strong><p>{dataError} No se guardarán cambios localmente.</p></div>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
