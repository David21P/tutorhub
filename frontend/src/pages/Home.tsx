import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/** Redirige a la pantalla principal según el rol. */
export default function Home() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'tutor') return <Navigate to="/calendario" replace />;
  return <Navigate to="/buscar" replace />;
}
