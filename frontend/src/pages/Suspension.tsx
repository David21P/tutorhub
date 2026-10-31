import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Field, Spinner, StatusBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtDateTime } from '../utils/format';

interface Info {
  suspended: boolean;
  reason: string | null;
  suspended_at: string | null;
  policies_url: string;
  appeals: { id: string; message: string; status: string; admin_response: string | null; created_at: string }[];
}

/** Única vista disponible para una cuenta suspendida. */
export default function Suspension() {
  const { refresh, logout } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Info>('/account/suspension').then((r) => setInfo(r.data)).catch((e) => toast.error(errorMessage(e)));
  }, [toast]);
  useEffect(load, [load]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/account/appeals', { message });
      toast.success('Apelación enviada. Un administrador la revisará.');
      setMessage('');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Si un administrador aceptó la apelación, se reactiva la cuenta al instante
  const check = async () => {
    const u = await refresh();
    if (u?.status === 'suspended') toast.info('Su cuenta sigue suspendida.');
  };

  if (!info) return <Spinner />;
  const pending = info.appeals.some((a) => a.status === 'pending');
  return (
    <div className="suspension stack">
      <div className="alert alert--error">
        <h1 style={{ fontSize: '1.3rem' }}>Su cuenta está suspendida</h1>
        <p>
          <strong>Motivo:</strong> {info.reason ?? 'No especificado'}
        </p>
        <p style={{ margin: 0 }}>
          <strong>Fecha:</strong> {info.suspended_at ? fmtDateTime(info.suspended_at) : '—'}
        </p>
      </div>
      <p>
        Mientras dure la suspensión no puede buscar tutores, reservar ni enviar mensajes. Revise nuestras{' '}
        <Link to="/politicas">políticas de uso</Link> y, si considera que fue un error, envíe una apelación.
      </p>

      <section className="card">
        <h2>Apelar la suspensión</h2>
        {pending ? (
          <div className="alert alert--info" style={{ marginBottom: 0 }}>
            Tiene una apelación en revisión. Le avisaremos cuando un administrador la resuelva.
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <Field label="Explique su caso" hint="Mínimo 20 caracteres.">
              <textarea required minLength={20} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <button className="btn" disabled={busy || message.trim().length < 20}>
              Enviar apelación
            </button>
          </form>
        )}
      </section>

      {info.appeals.length > 0 && (
        <section className="card">
          <h2>Historial de apelaciones</h2>
          {info.appeals.map((a) => (
            <div key={a.id} style={{ borderBottom: '1px solid #e3e6ef', padding: '0.6rem 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted small">{fmtDateTime(a.created_at)}</span>
                <StatusBadge status={a.status} />
              </div>
              <div className="small">{a.message}</div>
              {a.admin_response && (
                <div className="small">
                  <strong>Respuesta:</strong> {a.admin_response}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      <div className="row">
        <button className="btn btn--secondary" onClick={() => void check()}>
          Verificar estado de mi cuenta
        </button>
        <button className="btn btn--secondary" onClick={() => logout()}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
