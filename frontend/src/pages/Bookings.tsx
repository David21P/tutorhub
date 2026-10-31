import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { BookingDetail } from '../components/BookingDetail';
import { Empty, Spinner, StatusBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Booking, Subscription } from '../types';
import { MODALITY_LABEL, WEEKDAYS_SHORT, dt, fmtDate, fmtDateTime, minutesToLabel, money } from '../utils/format';

type Tab = 'pending' | 'upcoming' | 'history' | 'subs';

export default function Bookings() {
  const { user } = useAuth();
  const toast = useToast();
  const isTutor = user?.role === 'tutor';
  const [tab, setTab] = useState<Tab>(isTutor ? 'pending' : 'upcoming');
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([api.get<{ bookings: Booking[] }>('/bookings'), api.get<{ subscriptions: Subscription[] }>('/subscriptions')]);
      setBookings(b.data.bookings);
      setSubs(s.data.subscriptions);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  const now = dt(new Date().toISOString());
  const filtered = useMemo(() => {
    if (!bookings) return [];
    // las sesiones de suscripciones pendientes se responden desde la pestaña de suscripciones
    const list = bookings;
    if (tab === 'pending') return list.filter((b) => b.status === 'pending' && !b.subscription_id);
    if (tab === 'upcoming') return list.filter((b) => ['pending', 'approved'].includes(b.status) && dt(b.ends_at) > now);
    return list.filter((b) => ['completed', 'cancelled', 'rejected'].includes(b.status)).reverse();
  }, [bookings, tab, now]);

  const subAction = async (id: string, action: 'approve' | 'reject' | 'cancel' | 'renew', ok: string) => {
    try {
      await api.post(`/subscriptions/${id}/${action}`);
      toast.success(ok);
      void load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const toggleRenew = async (s: Subscription) => {
    try {
      await api.patch(`/subscriptions/${s.id}`, { auto_renew: !s.auto_renew });
      void load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const pendingCount = bookings?.filter((b) => b.status === 'pending' && !b.subscription_id).length ?? 0;
  const pendingSubs = subs?.filter((s) => s.status === 'pending').length ?? 0;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{isTutor ? 'Solicitudes y tutorías' : 'Mis tutorías'}</h1>
      </div>
      <div className="tabs">
        <button className={tab === 'pending' ? 'is-on' : ''} onClick={() => setTab('pending')}>
          {isTutor ? 'Solicitudes' : 'Pendientes'} {pendingCount > 0 && <span className="badge-dot">{pendingCount}</span>}
        </button>
        <button className={tab === 'upcoming' ? 'is-on' : ''} onClick={() => setTab('upcoming')}>
          Próximas
        </button>
        <button className={tab === 'history' ? 'is-on' : ''} onClick={() => setTab('history')}>
          Historial
        </button>
        <button className={tab === 'subs' ? 'is-on' : ''} onClick={() => setTab('subs')}>
          Suscripciones {pendingSubs > 0 && <span className="badge-dot">{pendingSubs}</span>}
        </button>
      </div>

      {(bookings === null || subs === null) && <Spinner />}

      {tab !== 'subs' && bookings !== null && (
        <>
          {filtered.length === 0 && <Empty>No hay tutorías en esta sección.</Empty>}
          <div className="stack" style={{ gap: '0.6rem' }}>
            {filtered.map((b) => (
              <article key={b.id} className="card card--link" style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{b.offer_title}</strong>
                    <div className="muted small">
                      {isTutor ? b.student_name : b.tutor_name} · {MODALITY_LABEL[b.modality]}
                      {b.subscription_id ? ' · suscripción' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <StatusBadge status={b.status} />
                    <div className="small">{money(b.total_amount)}</div>
                  </div>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  {fmtDateTime(b.starts_at)}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'subs' && subs !== null && (
        <>
          {subs.length === 0 && <Empty>No tiene suscripciones.</Empty>}
          <div className="stack" style={{ gap: '0.6rem' }}>
            {subs.map((s) => (
              <article key={s.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{s.offer_title}</strong>
                    <div className="muted small">
                      {isTutor ? s.student_name : s.tutor_name} · {MODALITY_LABEL[s.modality]}
                    </div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="small" style={{ margin: '0.5rem 0' }}>
                  {s.plan === 'monthly' ? 'Plan mensual' : `Bloque de ${s.weeks} semanas`} · {s.weekdays.map((d) => WEEKDAYS_SHORT[d - 1]).join(', ')} a las {minutesToLabel(s.start_min)} ({s.duration_min} min)
                  <br />
                  Desde {fmtDate(s.start_date)} · {s.sessions} sesiones ({s.upcoming} por venir) · Total {money(s.total_amount)}
                  {s.auto_renew && ' · renovación automática'}
                </div>
                <div className="row">
                  {isTutor && s.status === 'pending' && (
                    <>
                      <button className="btn btn--success btn--sm" onClick={() => void subAction(s.id, 'approve', 'Suscripción aprobada.')}>
                        Aprobar
                      </button>
                      <button className="btn btn--danger btn--sm" onClick={() => void subAction(s.id, 'reject', 'Suscripción rechazada.')}>
                        Rechazar
                      </button>
                    </>
                  )}
                  {!isTutor && s.status === 'active' && (
                    <button className="btn btn--secondary btn--sm" onClick={() => void subAction(s.id, 'renew', 'Se agregó otro bloque de sesiones.')}>
                      Renovar ahora
                    </button>
                  )}
                  {!isTutor && s.plan === 'monthly' && ['active', 'pending'].includes(s.status) && (
                    <button className="btn btn--secondary btn--sm" onClick={() => void toggleRenew(s)}>
                      {s.auto_renew ? 'Desactivar renovación automática' : 'Activar renovación automática'}
                    </button>
                  )}
                  {['pending', 'active'].includes(s.status) && (
                    <button className="btn btn--secondary btn--sm" onClick={() => void subAction(s.id, 'cancel', 'Suscripción cancelada.')}>
                      Cancelar suscripción
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {selected && <BookingDetail booking={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    </div>
  );
}
