import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorCode, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { OfferSummary, Quote, Slot } from '../types';
import { MODALITY_LABEL, TZ, WEEKDAYS_SHORT, fmtDateTime, minutesToLabel, money } from '../utils/format';
import { RouteMap } from './maps';
import { PriceBreakdown } from './PriceBreakdown';
import { Field } from './ui';

interface Props {
  tutorId: string;
  tutorName: string;
  tutorLoc: { lat: number; lng: number } | null;
  offers: OfferSummary[];
}

interface Preview {
  weeks: number;
  sessions: { starts_at: string; ends_at: string }[];
  per_session: Quote['breakdown'];
  route: Quote['route'];
  total_amount: number;
  ok: boolean;
  issue: { code: string; message: string } | null;
}

const DURATIONS = [30, 60, 90, 120, 150, 180, 240];
const todayStr = () => DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate() as string;

const timeOptions = (() => {
  const out: number[] = [];
  for (let m = 6 * 60; m <= 21 * 60; m += 30) out.push(m);
  return out;
})();

export function BookingPanel({ tutorId, tutorName, tutorLoc, offers }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'single' | 'subscription'>('single');
  const [offerId, setOfferId] = useState(offers[0]?.id ?? '');
  const offer = useMemo(() => offers.find((o) => o.id === offerId) ?? offers[0], [offers, offerId]);
  const [modality, setModality] = useState(offer?.modalities[0] ?? 'virtual');
  const [minutes, setMinutes] = useState(60);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sesión única
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<string>('');

  // suscripción
  const [plan, setPlan] = useState<'monthly' | 'block'>('monthly');
  const [weeks, setWeeks] = useState(4);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [startMin, setStartMin] = useState(16 * 60);
  const [autoRenew, setAutoRenew] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    if (offer && !offer.modalities.includes(modality)) setModality(offer.modalities[0] ?? 'virtual');
  }, [offer, modality]);

  // Presupuesto con ruta real
  useEffect(() => {
    if (!offer) return;
    let cancelled = false;
    setQuote(null);
    api
      .post<{ quote: Quote }>('/bookings/quote', { offer_id: offer.id, modality, minutes })
      .then((r) => !cancelled && (setQuote(r.data.quote), setError(null)))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [offer, modality, minutes]);

  // Horarios libres
  const loadSlots = useCallback(() => {
    setSlot('');
    setSlots(null);
    api
      .get<{ slots: Slot[] }>(`/tutors/${tutorId}/slots`, { params: { date, minutes } })
      .then((r) => setSlots(r.data.slots))
      .catch(() => setSlots([]));
  }, [tutorId, date, minutes]);
  useEffect(() => {
    if (mode === 'single') loadSlots();
  }, [mode, loadSlots]);

  // Vista previa de suscripción
  const planBody = useMemo(
    () => ({
      offer_id: offer?.id,
      modality,
      plan,
      weeks: plan === 'block' ? weeks : undefined,
      weekdays,
      start_min: startMin,
      duration_min: minutes,
      start_date: date,
      auto_renew: plan === 'monthly' && autoRenew,
    }),
    [offer?.id, modality, plan, weeks, weekdays, startMin, minutes, date, autoRenew],
  );
  useEffect(() => {
    if (mode !== 'subscription' || weekdays.length === 0 || !offer) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    api
      .post<Preview>('/subscriptions/preview', planBody)
      .then((r) => !cancelled && (setPreview(r.data), setError(null)))
      .catch((err) => !cancelled && (setPreview(null), setError(errorMessage(err))));
    return () => {
      cancelled = true;
    };
  }, [mode, planBody, weekdays.length, offer]);

  if (!offer) return <div className="alert alert--info">Este tutor aún no tiene ofertas publicadas.</div>;
  if (user?.role !== 'student') return null;

  const toggleDay = (d: number) => setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  const requestSingle = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/bookings', { offer_id: offer.id, modality, minutes, starts_at: slot, notes: notes || undefined });
      toast.success('Solicitud enviada. El tutor debe aprobarla.');
      navigate('/mis-tutorias');
    } catch (err) {
      setError(errorMessage(err));
      if (['TUTOR_TIME_CONFLICT', 'STUDENT_TIME_CONFLICT'].includes(errorCode(err) ?? '')) loadSlots();
    } finally {
      setBusy(false);
    }
  };

  const requestSubscription = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/subscriptions', planBody);
      toast.success('Suscripción solicitada. El tutor debe aprobarla.');
      navigate('/mis-tutorias');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const needsLocation = modality !== 'virtual';
  return (
    <div className="card stack" aria-label="Reservar">
      <h2>Reservar con {tutorName}</h2>
      <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
        <button role="tab" className={mode === 'single' ? 'is-on' : ''} onClick={() => setMode('single')}>
          Una sesión
        </button>
        <button role="tab" className={mode === 'subscription' ? 'is-on' : ''} onClick={() => setMode('subscription')}>
          Suscripción recurrente
        </button>
      </div>

      {offers.length > 1 && (
        <Field label="Tutoría">
          <select value={offer.id} onChange={(e) => setOfferId(e.target.value)}>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title} · {money(o.hourly_rate)}/h
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="form-grid">
        <Field label="Modalidad">
          <select value={modality} onChange={(e) => setModality(e.target.value as typeof modality)}>
            {offer.modalities.map((m) => (
              <option key={m} value={m}>
                {MODALITY_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duración">
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d >= 60 ? `${d / 60} h` : `${d} min`}
                {d > 60 && d % 60 ? ` (${d} min)` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {mode === 'single' ? (
        <>
          <Field label="Fecha">
            <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="field">
            <span className="label">Horarios disponibles</span>
            {slots === null ? (
              <span className="muted small">Cargando…</span>
            ) : slots.length === 0 ? (
              <span className="muted small">No hay horarios libres ese día. Pruebe otra fecha o duración.</span>
            ) : (
              <div className="slots">
                {slots.map((s) => (
                  <button type="button" key={s.starts_at} className={`slot${slot === s.starts_at ? ' is-on' : ''}`} onClick={() => setSlot(s.starts_at)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Field label="Notas para el tutor (opcional)">
            <textarea style={{ minHeight: 60 }} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label="Plan">
              <select value={plan} onChange={(e) => setPlan(e.target.value as 'monthly' | 'block')}>
                <option value="monthly">Mensual (4 semanas)</option>
                <option value="block">Bloque de semanas</option>
              </select>
            </Field>
            {plan === 'block' && (
              <Field label="Semanas">
                <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                  <option value={4}>4 semanas</option>
                  <option value={8}>8 semanas</option>
                </select>
              </Field>
            )}
            <Field label="Inicia el">
              <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Hora de inicio">
              <select value={startMin} onChange={(e) => setStartMin(Number(e.target.value))}>
                {timeOptions.map((m) => (
                  <option key={m} value={m}>
                    {minutesToLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="field">
            <span className="label">Días fijos de la semana</span>
            <div className="checks">
              {WEEKDAYS_SHORT.map((d, i) => (
                <label key={d} className={`chip${weekdays.includes(i + 1) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={weekdays.includes(i + 1)} onChange={() => toggleDay(i + 1)} />
                  {d}
                </label>
              ))}
            </div>
          </div>
          {plan === 'monthly' && (
            <label className="row small">
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} style={{ width: 'auto' }} />
              Renovar automáticamente cada mes
            </label>
          )}
          {preview && (
            <div className={`alert ${preview.ok ? 'alert--success' : 'alert--error'}`}>
              {preview.ok ? (
                <>
                  <strong>{preview.sessions.length} sesiones</strong> · primera: {fmtDateTime(preview.sessions[0]?.starts_at ?? '')} · última:{' '}
                  {fmtDateTime(preview.sessions[preview.sessions.length - 1]?.starts_at ?? '')}
                </>
              ) : (
                preview.issue?.message
              )}
            </div>
          )}
        </>
      )}

      {needsLocation && tutorLoc && user.lat != null && user.lng != null && (
        <div className="stack" style={{ gap: '0.5rem' }}>
          <span className="label small">
            Ruta {modality === 'student_home' ? 'del tutor a su domicilio' : 'hacia el tutor'} (la ubicación sale de su perfil)
          </span>
          <RouteMap tutor={{ ...tutorLoc, label: tutorName }} student={{ lat: user.lat, lng: user.lng, label: 'Su ubicación' }} route={quote?.route} />
        </div>
      )}

      {quote && (
        <div>
          <h3>Presupuesto</h3>
          <PriceBreakdown b={quote.breakdown} route={quote.route} sessions={mode === 'subscription' ? preview?.sessions.length ?? 1 : 1} />
        </div>
      )}

      {error && <div className="alert alert--error">{error}</div>}
      {mode === 'single' ? (
        <button className="btn btn--block" disabled={!slot || busy || !quote} onClick={() => void requestSingle()}>
          {busy ? 'Enviando…' : 'Solicitar tutoría'}
        </button>
      ) : (
        <button className="btn btn--block" disabled={!preview?.ok || busy} onClick={() => void requestSubscription()}>
          {busy ? 'Enviando…' : 'Solicitar suscripción'}
        </button>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        La tutoría queda <strong>pendiente</strong> hasta que el tutor la apruebe. Mientras esté pendiente, ese horario no puede ser tomado por otra persona.
      </p>
    </div>
  );
}
