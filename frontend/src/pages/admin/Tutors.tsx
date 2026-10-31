import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Empty, Modal, Spinner, StatusBadge } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { openFile } from '../../utils/files';
import { money } from '../../utils/format';

interface TutorRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  bio: string;
  hourly_rate: number;
  cv_file_id: string | null;
  portfolio_url: string | null;
  approval_status: string;
  approval_note: string | null;
  rating_avg: number;
  rating_count: number;
}

/** Revisión y aprobación de tutores antes de que puedan publicar. */
export default function Tutors() {
  const toast = useToast();
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState<TutorRow[] | null>(null);
  const [reject, setReject] = useState<TutorRow | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setRows(null);
    api
      .get<{ tutors: TutorRow[] }>('/admin/tutors', { params: filter ? { status: filter } : {} })
      .then((r) => setRows(r.data.tutors))
      .catch((e) => toast.error(errorMessage(e)));
  }, [filter, toast]);
  useEffect(load, [load]);

  const decide = async (t: TutorRow, status: 'approved' | 'rejected', n?: string) => {
    try {
      await api.post(`/admin/tutors/${t.id}/approval`, { status, note: n });
      toast.success(status === 'approved' ? 'Tutor aprobado.' : 'Tutor rechazado.');
      setReject(null);
      setNote('');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Aprobación de tutores</h1>
      </div>
      <div className="tabs">
        {[
          ['pending', 'Pendientes'],
          ['approved', 'Aprobados'],
          ['rejected', 'Rechazados'],
        ].map(([k, label]) => (
          <button key={k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      {!rows && <Spinner />}
      {rows?.length === 0 && <Empty>No hay tutores en esta lista.</Empty>}
      <div className="stack" style={{ gap: '0.75rem' }}>
        {rows?.map((t) => (
          <article key={t.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{t.name}</strong>
                <div className="muted small">
                  {t.email} · {t.phone} · {money(t.hourly_rate)}/h
                </div>
              </div>
              <StatusBadge status={t.approval_status} />
            </div>
            <p className="small" style={{ margin: '0.5rem 0' }}>
              {t.bio}
            </p>
            <div className="row">
              {t.cv_file_id && (
                <button className="btn btn--secondary btn--sm" onClick={() => openFile(t.cv_file_id as string).catch((e) => toast.error(errorMessage(e)))}>
                  Hoja de vida
                </button>
              )}
              {t.portfolio_url && (
                <a className="btn btn--secondary btn--sm" href={t.portfolio_url} target="_blank" rel="noopener noreferrer">
                  Portafolio
                </a>
              )}
              {t.approval_status !== 'approved' && (
                <button className="btn btn--success btn--sm" onClick={() => void decide(t, 'approved')}>
                  Aprobar
                </button>
              )}
              {t.approval_status !== 'rejected' && (
                <button className="btn btn--danger btn--sm" onClick={() => setReject(t)}>
                  Rechazar
                </button>
              )}
            </div>
            {t.approval_note && <div className="small muted">Nota: {t.approval_note}</div>}
          </article>
        ))}
      </div>
      {reject && (
        <Modal title={`Rechazar a ${reject.name}`} onClose={() => setReject(null)}>
          <div className="field">
            <label className="label">Motivo (se mostrará al tutor)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="btn btn--danger" onClick={() => void decide(reject, 'rejected', note)}>
            Confirmar rechazo
          </button>
        </Modal>
      )}
    </div>
  );
}
