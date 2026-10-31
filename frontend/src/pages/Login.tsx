import { GoogleLogin } from '@react-oauth/google';
import { FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';

const GOOGLE_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const DEV = import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true';

export default function Login() {
  const { user, loading, notice, loginWithGoogle, devLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  if (loading) return <Spinner />;
  if (user) return <Navigate to="/" replace />;

  const onGoogle = async (credential?: string) => {
    if (!credential) return setError('Google no devolvió una credencial.');
    try {
      setError(null);
      await loginWithGoogle(credential);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'No se pudo iniciar sesión con Google.'));
    }
  };

  const onDev = async (e: FormEvent, value?: string) => {
    e.preventDefault();
    try {
      setError(null);
      await devLogin(value ?? email);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="login">
      <section className="login__hero">
        <h1>TutorHub</h1>
        <p>El marketplace educativo que conecta a estudiantes con tutores verificados.</p>
        <ul>
          <li>Busque tutores por cercanía, precio, calificación y modalidad</li>
          <li>Agende clases virtuales o presenciales con el costo de traslado calculado</li>
          <li>Suscríbase a clases recurrentes semanales</li>
          <li>Converse en tiempo real con su tutor</li>
        </ul>
      </section>
      <section className="login__panel">
        <div className="login__box stack">
          <div>
            <h2>Iniciar sesión</h2>
            <p className="muted">Use su cuenta de Google para continuar.</p>
          </div>
          {notice && <div className="alert alert--warn">{notice}</div>}
          {error && <div className="alert alert--error">{error}</div>}
          {GOOGLE_ID ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GoogleLogin onSuccess={(r) => void onGoogle(r.credential)} onError={() => setError('No se pudo completar el inicio de sesión con Google.')}  />
            </div>
          ) : (
            <div className="alert alert--info small">Google no está configurado (falta VITE_GOOGLE_CLIENT_ID).</div>
          )}
          {DEV && (
            <form onSubmit={(e) => void onDev(e)} className="stack" style={{ gap: '0.5rem', borderTop: '1px solid #e3e6ef', paddingTop: '1rem' }}>
              <strong className="small">Acceso de desarrollo (sin Google)</strong>
              <input type="email" required placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn btn--secondary" type="submit">
                Entrar con correo
              </button>
              <div className="row" style={{ gap: '0.35rem' }}>
                {['admin@demo.com', 'ana.tutora@demo.com', 'maria.estudiante@demo.com'].map((d) => (
                  <button key={d} type="button" className="btn btn--secondary btn--sm" onClick={(e) => void onDev(e, d)}>
                    {d.split('@')[0]}
                  </button>
                ))}
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
