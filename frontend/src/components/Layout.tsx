import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { Conversation } from '../types';
import { Avatar, Spinner } from './ui';

function useUnread(enabled: boolean): number {
  const socket = useSocket();
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  useEffect(() => {
    if (!enabled) return;
    api
      .get<{ conversations: Conversation[] }>('/chat/conversations')
      .then((r) => setUnread(r.data.conversations.reduce((a, c) => a + c.unread, 0)))
      .catch(() => undefined);
  }, [enabled, location.pathname, socket]);
  useEffect(() => {
    if (!socket) return;
    const bump = () => setUnread((n) => n + 1);
    socket.on('message:new', bump);
    return () => {
      socket.off('message:new', bump);
    };
  }, [socket]);
  return unread;
}

/** Estructura común de las pantallas privadas: valida sesión, onboarding y suspensión. */
export function Layout() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isChatUser = Boolean(user && user.onboarded && user.status === 'active' && user.role !== 'admin');
  const unread = useUnread(isChatUser);

  useEffect(() => setOpen(false), [location.pathname]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.status === 'suspended' && location.pathname !== '/suspension' && location.pathname !== '/politicas') {
    return <Navigate to="/suspension" replace />;
  }
  if (user.status === 'active' && location.pathname === '/suspension') return <Navigate to="/" replace />;
  if (!user.onboarded && user.role !== 'admin' && location.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;

  const suspended = user.status === 'suspended';
  const links: { to: string; label: string; badge?: number }[] = [];
  if (!suspended && user.onboarded) {
    if (user.role === 'student') {
      links.push({ to: '/buscar', label: 'Buscar tutores' }, { to: '/calendario', label: 'Calendario' }, { to: '/mis-tutorias', label: 'Mis tutorías' });
    } else if (user.role === 'tutor') {
      links.push(
        { to: '/calendario', label: 'Calendario' },
        { to: '/mis-tutorias', label: 'Solicitudes' },
        { to: '/mis-ofertas', label: 'Mis ofertas' },
        { to: '/disponibilidad', label: 'Disponibilidad' },
      );
    } else if (user.role === 'admin') {
      links.push(
        { to: '/admin', label: 'Panel' },
        { to: '/admin/categorias', label: 'Categorías' },
        { to: '/admin/tutores', label: 'Tutores' },
        { to: '/admin/moderacion', label: 'Moderación' },
        { to: '/admin/usuarios', label: 'Usuarios' },
      );
    }
    if (user.role !== 'admin') links.push({ to: '/chat', label: 'Mensajes', badge: unread });
  }

  return (
    <div className="app-shell">
      <header className="navbar">
        <div className="navbar__inner">
          <Link to="/" className="navbar__brand">
            TutorHub
          </Link>
          <button className="navbar__toggle" onClick={() => setOpen((o) => !o)} aria-label="Menú" aria-expanded={open}>
            ☰
          </button>
          <nav className={`navbar__links${open ? ' is-open' : ''}`}>
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/admin'} className={({ isActive }) => `navbar__link${isActive ? ' active' : ''}`}>
                {l.label}
                {l.badge ? <span className="badge-dot">{l.badge}</span> : null}
              </NavLink>
            ))}
            <div className="navbar__user">
              <Link to={user.role === 'admin' || suspended ? '#' : '/perfil'} className="row" style={{ gap: '0.4rem', color: 'inherit' }}>
                <Avatar name={user.name} url={user.photo_url} />
                <span className="small">{user.name.split(' ')[0]}</span>
              </Link>
              <button className="btn btn--secondary btn--sm" onClick={() => logout()}>
                Salir
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main className="container" style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}

/** Restringe una ruta a ciertos roles. */
export function RoleRoute({ roles }: { roles: ('student' | 'tutor' | 'admin')[] }) {
  const { user } = useAuth();
  if (!user?.role || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
