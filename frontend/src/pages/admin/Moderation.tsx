import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Empty, Field, Modal, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { REASON_LABEL, fmtDateTime } from '../../utils/format';

interface ReportRow {
  id: string;
  reason: string;
  description: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
  reporter_name: string;
  reported_id: string;
  reported_name: string;
  reported_status: string;
  reported_role: string;
  reported_total_reports: number;
}
interface AppealRow {
  id: string;
  message: string;
  status: string;
  admin_response: string | null;
  created_at: string;
  user_name: string;
  user_email: string;
  suspended_reason: string | null;
  suspended_at: string | null;
}
interface AuditRow {
  id: number;
  action: string;
  entity: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

type Tab = 'reports' | 'reports-history' | 'appeals' | 'appeals-history' | 'audit';

export default function Moderation() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('reports');
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [appeals, setAppeals] = useState<AppealRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [resolving, setResolving] = useState<ReportRow | null>(null);
  const [answering, setAnswering] = useState<AppealRow | null>(null);
  const [note, setNote] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const load = useCallback(() => {
    const fail = (e: unknown) => toast.error(errorMessage(e));
    if (tab === 'reports' || tab === 'reports-history') {
      setReports(null);
      api.get<{ reports: ReportRow[] }>('/admin/reports', { params: { view: tab === 'reports' ? 'open' : 'history' } }).then((r) => setReports(r.data.reports)).catch(fail);
    } else if (tab === 'appeals' || tab === 'appeals-history') {
      setAppeals(null);
      api.get<{ appeals: AppealRow[] }>('/admin/appeals', { params: { view: tab === 'appeals' ? 'pending' : 'history' } }).then((r) => setAppeals(r.data.appeals)).catch(fail);
    } else {
      setAudit(null);
      api.get<{ entries: AuditRow[] }>('/admin/audit', { params: { limit: 200 } }).then((r) => setAudit(r.data.entries)).catch(fail);
    }
  }, [tab, toast]);
  useEffect(load, [load]);

  const closeModals = () => {
    setResolving(null);
    setAnswering(null);
    setNote('');
    setSuspend(false);
    setSuspendReason('');
  };

  const resolveReport = async (status: 'resolved' | 'dismissed') => {
    if (!resolving) return;
    try {
      await api.post(`/admin/reports/${resolving.id}/resolve`, {
        status,
        note,
        suspend_reason: status === 'resolved' && suspend ? suspendReason : undefined,
      });
      toast.success(suspend && status === 'resolved' ? 'Reporte resuelto y cuenta suspendida.' : 'Reporte actualizado.');
      closeModals();
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const resolveAppeal = async (decision: 'accepted' | 'rejected') => {
    if (!answering) return;
    try {
      await api.post(`/admin/appeals/${answering.id}/resolve`, { decision, response: note });
      toast.success(decision === 'accepted' ? 'Apelación aceptada: la cuenta fue reactivada.' : 'Apelación rechazada.');
      closeModals();
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const tabs: [Tab, string][] = [
    ['reports', 'Reportes abiertos'],
    ['reports-history', 'Historial de reportes'],
    ['appeals', 'Apelaciones'],
    ['appeals-history', 'Historial de apelaciones'],
    ['audit', 'Auditoría'],
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Moderación</h1>
      </div>
      <div className="tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {(tab === 'reports' || tab === 'reports-history') && (
        <>
          {!reports && <Spinner />}
          {reports?.length === 0 && <Empty>No hay reportes en esta bandeja.</Empty>}
          {reports?.map((r) => (
            <article key={r.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <span className="badge badge--pending">{REASON_LABEL[r.reason] ?? r.reason}</span>{' '}
                  <strong>{r.reported_name}</strong> <span className="muted small">({r.reported_role === 'tutor' ? 'tutor' : 'estudiante'} · {r.reported_total_reports} reporte(s) en total)</span>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="muted small">
                Reportado por {r.reporter_name} · {fmtDateTime(r.created_at)}
                {r.reported_status === 'suspended' && ' · cuenta suspendida'}
              </div>
              <p style={{ margin: '0.5rem 0' }}>{r.description}</p>
              {r.resolution_note && <div className="small"><strong>Resolución:</strong> {r.resolution_note}</div>}
              {r.status === 'open' && (
                <button className="btn btn--sm" onClick={() => setResolving(r)}>
                  Revisar y resolver
                </button>
              )}
            </article>
          ))}
        </>
      )}

      {(tab === 'appeals' || tab === 'appeals-history') && (
        <>
          {!appeals && <Spinner />}
          {appeals?.length === 0 && <Empty>No hay apelaciones en esta bandeja.</Empty>}
          {appeals?.map((a) => (
            <article key={a.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{a.user_name}</strong> <span className="muted small">{a.user_email}</span>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <div className="small muted">
                Suspendido: {a.suspended_at ? fmtDateTime(a.suspended_at) : '—'} · Motivo: {a.suspended_reason ?? '—'}
              </div>
              <p style={{ margin: '0.5rem 0' }}>
                <strong>Apelación:</strong> {a.message}
              </p>
              {a.admin_response && <div className="small"><strong>Respuesta:</strong> {a.admin_response}</div>}
              {a.status === 'pending' && (
                <button className="btn btn--sm" onClick={() => setAnswering(a)}>
                  Responder
                </button>
              )}
            </article>
          ))}
        </>
      )}

      {tab === 'audit' && (
        <>
          {!audit && <Spinner />}
          {audit && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Acción</th>
                    <th>Actor</th>
                    <th>Entidad</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap small">{fmtDateTime(e.created_at)}</td>
                      <td>
                        <code>{e.action}</code>
                      </td>
                      <td className="small">{e.actor_name ?? 'Sistema'}</td>
                      <td className="small">{e.entity}</td>
                      <td className="small muted">{e.data && Object.keys(e.data).length ? JSON.stringify(e.data) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {resolving && (
        <Modal title="Resolver reporte" onClose={closeModals}>
          <p className="small">
            <strong>{REASON_LABEL[resolving.reason]}</strong> contra <strong>{resolving.reported_name}</strong>
          </p>
          <p className="small muted">{resolving.description}</p>
          <Field label="Nota de resolución">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {resolving.reported_status !== 'suspended' && (
            <>
              <label className="row small" style={{ marginBottom: '0.5rem' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={suspend} onChange={(e) => setSuspend(e.target.checked)} /> Suspender la cuenta del usuario reportado
              </label>
              {suspend && (
                <Field label="Motivo de la suspensión (lo verá el usuario)">
                  <textarea style={{ minHeight: 70 }} value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
                </Field>
              )}
            </>
          )}
          <div className="row">
            <button className="btn btn--success" disabled={note.trim().length < 5 || (suspend && suspendReason.trim().length < 10)} onClick={() => void resolveReport('resolved')}>
              Dar la razón al reporte
            </button>
            <button className="btn btn--secondary" disabled={note.trim().length < 5} onClick={() => void resolveReport('dismissed')}>
              Desestimar
            </button>
          </div>
        </Modal>
      )}

      {answering && (
        <Modal title={`Apelación de ${answering.user_name}`} onClose={closeModals}>
          <p className="small muted">Motivo de la suspensión: {answering.suspended_reason}</p>
          <p>{answering.message}</p>
          <Field label="Respuesta al usuario">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn btn--success" disabled={note.trim().length < 5} onClick={() => void resolveAppeal('accepted')}>
              Aceptar y reactivar cuenta
            </button>
            <button className="btn btn--danger" disabled={note.trim().length < 5} onClick={() => void resolveAppeal('rejected')}>
              Rechazar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
