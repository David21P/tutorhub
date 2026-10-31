import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Booking } from '../types';
import { MODALITY_LABEL, REASON_LABEL, dt, fmtDateTime, fmtTime, whatsappShareUrl } from '../utils/format';
import { RouteMap } from './maps';
import { PriceBreakdown } from './PriceBreakdown';
import { Field, Modal, StarInput, StatusBadge } from './ui';

interface Props {
  booking: Booking;
  onClose: () => void;
  onChanged: () => void;
}

/** Detalle de una tutoría con acciones según el rol y el estado. */
export function BookingDetail({ booking: b, onClose, onChanged }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'review' | 'report' | 'cancel'>('view');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState<keyof typeof REASON_LABEL>('inasistencia');
  const [description, setDescription] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const isTutor = user?.id === b.tutor_id;
  const counterpart = isTutor ? b.student_name : b.tutor_name;
  const counterpartId = isTutor ? b.student_id : b.tutor_id;
  const future = dt(b.starts_at) > dt(new Date().toISOString());

  const run = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shareText = `Tutoría de ${b.offer_title}\n${isTutor ? 'Estudiante' : 'Tutor'}: ${counterpart}\nHorario: ${fmtDateTime(b.starts_at)} – ${fmtTime(b.ends_at)}\nModalidad: ${MODALITY_LABEL[b.modality]}\nTotal: Q${b.total_amount.toFixed(2)}`;

  const hasRouteData = b.modality !== 'virtual' && b.tutor_lat != null && b.tutor_lng != null && b.student_lat != null && b.student_lng != null;

  if (mode === 'review') {
    return (
      <Modal title="Calificar tutoría" onClose={onClose}>
        <p className="muted">¿Cómo fue su experiencia con {counterpart}?</p>
        <StarInput value={rating} onChange={setRating} />
        <Field label="Comentario (opcional)">
          <textarea value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void run(() => api.post('/reviews', { booking_id: b.id, rating, comment }), '¡Gracias por su reseña!')}>
            Enviar reseña
          </button>
          <button className="btn btn--secondary" onClick={() => setMode('view')}>
            Volver
          </button>
        </div>
      </Modal>
    );
  }

  if (mode === 'report') {
    return (
      <Modal title={`Reportar a ${counterpart}`} onClose={onClose}>
        <Field label="Motivo">
          <select value={reason} onChange={(e) => setReason(e.target.value as keyof typeof REASON_LABEL)}>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Evidencia" hint="Describa lo ocurrido con el mayor detalle posible (mínimo 20 caracteres).">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <div className="row">
          <button
            className="btn btn--danger"
            disabled={busy || description.trim().length < 20}
            onClick={() => void run(() => api.post('/reports', { reported_id: counterpartId, booking_id: b.id, reason, description }), 'Reporte enviado. Un administrador lo revisará.')}
          >
            Enviar reporte
          </button>
          <button className="btn btn--secondary" onClick={() => setMode('view')}>
            Volver
          </button>
        </div>
      </Modal>
    );
  }

  if (mode === 'cancel') {
    return (
      <Modal title="Cancelar tutoría" onClose={onClose}>
        <Field label="Motivo (opcional)">
          <textarea style={{ minHeight: 70 }} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />
        </Field>
        <div className="row">
          <button className="btn btn--danger" disabled={busy} onClick={() => void run(() => api.post(`/bookings/${b.id}/cancel`, { reason: cancelReason }), 'Tutoría cancelada.')}>
            Confirmar cancelación
          </button>
          <button className="btn btn--secondary" onClick={() => setMode('view')}>
            Volver
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={b.offer_title} onClose={onClose}>
      <div className="stack" style={{ gap: '0.75rem' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <StatusBadge status={b.status} />
          <span className="muted small">{b.category_name}</span>
        </div>
        <div>
          <div>
            <strong>{isTutor ? 'Estudiante' : 'Tutor'}:</strong> {counterpart}
          </div>
          <div>
            <strong>Cuándo:</strong> {fmtDateTime(b.starts_at)} – {fmtTime(b.ends_at)}
          </div>
          <div>
            <strong>Modalidad:</strong> {MODALITY_LABEL[b.modality]}
          </div>
          {b.modality === 'student_home' && b.student_address && (
            <div>
              <strong>Domicilio del estudiante:</strong> {b.student_address}
            </div>
          )}
          {b.modality === 'tutor_home' && b.tutor_address && (
            <div>
              <strong>Casa del tutor:</strong> {b.tutor_address}
            </div>
          )}
          {b.notes && (
            <div>
              <strong>Notas:</strong> {b.notes}
            </div>
          )}
          {b.cancel_reason && (
            <div>
              <strong>Motivo de cancelación:</strong> {b.cancel_reason}
            </div>
          )}
        </div>

        {hasRouteData && (
          <RouteMap
            tutor={{ lat: b.tutor_lat as number, lng: b.tutor_lng as number, label: b.tutor_name }}
            student={{ lat: b.student_lat as number, lng: b.student_lng as number, label: b.student_name }}
          />
        )}

        <PriceBreakdown
          b={{
            minutes: b.hours * 60, hours: b.hours, hourly_rate: b.hourly_rate, base_amount: b.base_amount, distance_km: b.distance_km,
            km_rate: b.km_rate, round_trip: false, billable_km: b.km_rate > 0 ? b.travel_amount / b.km_rate : 0, travel_amount: b.travel_amount, total_amount: b.total_amount,
          }}
        />

        <div className="row">
          <a className="btn btn--whatsapp btn--sm" href={whatsappShareUrl(shareText)} target="_blank" rel="noopener noreferrer">
            Compartir por WhatsApp
          </a>
          {b.counterpart_phone && (
            <a className="btn btn--secondary btn--sm" href={whatsappShareUrl(`Hola ${counterpart}, te escribo por la tutoría del ${fmtDateTime(b.starts_at)}.`, b.counterpart_phone)} target="_blank" rel="noopener noreferrer">
              Escribir a {counterpart.split(' ')[0]}
            </a>
          )}
        </div>

        <div className="row" style={{ borderTop: '1px solid #e3e6ef', paddingTop: '0.75rem' }}>
          {isTutor && b.status === 'pending' && !b.subscription_id && (
            <>
              <button className="btn btn--success" disabled={busy} onClick={() => void run(() => api.post(`/bookings/${b.id}/approve`), 'Tutoría aprobada.')}>
                Aprobar
              </button>
              <button className="btn btn--danger" disabled={busy} onClick={() => void run(() => api.post(`/bookings/${b.id}/reject`), 'Solicitud rechazada.')}>
                Rechazar
              </button>
            </>
          )}
          {b.subscription_id && b.status === 'pending' && isTutor && <span className="muted small">Responda desde “Suscripciones”.</span>}
          {['pending', 'approved'].includes(b.status) && future && (
            <button className="btn btn--secondary" onClick={() => setMode('cancel')}>
              Cancelar tutoría
            </button>
          )}
          {!isTutor && b.status === 'completed' && !b.reviewed && (
            <button className="btn" onClick={() => setMode('review')}>
              Calificar
            </button>
          )}
          {b.status === 'completed' && b.reviewed && !isTutor && <span className="muted small">Ya calificó esta tutoría.</span>}
          <button className="btn btn--secondary btn--sm" onClick={() => setMode('report')}>
            Reportar
          </button>
        </div>
      </div>
    </Modal>
  );
}
