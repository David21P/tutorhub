import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Empty, Field, Modal, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useDebounced } from '../../hooks/useDebounced';
import { fmtDate } from '../../utils/format';

interface Row {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  suspended_reason: string | null;
}

export default function Users() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const dq = useDebounced(q);

  const load = useCallback(() => {
    api
      .get<{ users: (Row & { created_at: string })[] }>('/admin/users', { params: { q: dq || undefined, status: status || undefined } })
      .then((r) => setRows(r.data.users))
      .catch((e) => toast.error(errorMessage(e)));
  }, [dq, status, toast]);
  useEffect(load, [load]);

  const suspend = async () => {
    if (!target) return;
    try {
      await api.post(`/admin/users/${target.id}/suspend`, { reason });
      toast.success('Cuenta suspendida.');
      setTarget(null);
      setReason('');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const reactivate = async (u: Row) => {
    try {
      await api.post(`/admin/users/${u.id}/reactivate`);
      toast.success('Cuenta reactivada.');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Usuarios</h1>
      </div>
      <div className="row">
        <input type="search" placeholder="Buscar por nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="suspended">Suspendidos</option>
        </select>
      </div>
      {!rows && <Spinner />}
      {rows?.length === 0 && <Empty>No hay usuarios con ese criterio.</Empty>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <div className="muted small">{u.email}</div>
                    {u.suspended_reason && <div className="small">Motivo: {u.suspended_reason}</div>}
                  </td>
                  <td>{u.role === 'tutor' ? 'Tutor' : 'Estudiante'}</td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="right">
                    {u.status === 'active' ? (
                      <button className="btn btn--danger btn--sm" onClick={() => setTarget(u)}>
                        Suspender
                      </button>
                    ) : (
                      <button className="btn btn--success btn--sm" onClick={() => void reactivate(u)}>
                        Reactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <Modal title={`Suspender a ${target.name}`} onClose={() => setTarget(null)}>
          <Field label="Motivo (lo verá el usuario)" hint={`Fecha: ${fmtDate(new Date().toISOString())}`}>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <button className="btn btn--danger" disabled={reason.trim().length < 10} onClick={() => void suspend()}>
            Confirmar suspensión
          </button>
        </Modal>
      )}
    </div>
  );
}
