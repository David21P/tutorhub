import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { BookingPanel } from '../components/BookingPanel';
import { Avatar, Spinner, Stars } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { TutorDetail } from '../types';
import { openFile } from '../utils/files';
import { MODALITY_LABEL, WEEKDAYS, kmLabel, minutesToLabel, money, whatsappShareUrl } from '../utils/format';

export default function TutorProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<TutorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api
      .get<TutorDetail>(`/tutors/${id}`)
      .then((r) => setData(r.data))
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  if (error) return <div className="alert alert--error">{error}</div>;
  if (!data) return <Spinner />;
  const { tutor, offers, availability, reviews } = data;

  const startChat = async () => {
    try {
      const r = await api.post<{ id: string }>('/chat/conversations', { tutor_id: tutor.id });
      navigate(`/chat?c=${r.data.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const baseRate = offers.length ? Math.min(...offers.map((o) => o.hourly_rate)) : null;
  const shareText = [
    `${tutor.name} en TutorHub`,
    offers.length ? `Ofrece: ${offers.map((o) => o.title).join(', ')}` : null,
    baseRate !== null ? `Tarifa base desde ${money(baseRate)} por hora` : null,
    `Ver perfil: ${window.location.origin}/tutor/${tutor.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const byDay = WEEKDAYS.map((name, i) => ({
    name,
    blocks: availability.filter((a) => a.weekday === i + 1),
  }));

  return (
    <div className="grid grid--main">
      <div className="stack">
        <section className="card">
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <Avatar name={tutor.name} url={tutor.photo_url} large />
            <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: 4 }}>{tutor.name}</h1>
              <Stars value={tutor.rating_avg} count={tutor.rating_count} />
              <div className="muted small">
                {tutor.address ?? 'Ubicación no indicada'} · a {kmLabel(tutor.distance_km)} de usted
              </div>
            </div>
          </div>
          <p style={{ marginTop: '1rem' }}>{tutor.bio}</p>
          <div className="row">
            {user?.role === 'student' && (
              <button className="btn btn--secondary" onClick={() => void startChat()}>
                Enviar mensaje
              </button>
            )}
            {tutor.cv_file_id && (
              <button className="btn btn--secondary" onClick={() => openFile(tutor.cv_file_id as string).catch((e) => toast.error(errorMessage(e)))}>
                Ver hoja de vida
              </button>
            )}
            <a className="btn btn--whatsapp" href={whatsappShareUrl(shareText)} target="_blank" rel="noopener noreferrer">
              Compartir perfil
            </a>
            {tutor.portfolio_url && (
              <a className="btn btn--secondary" href={tutor.portfolio_url} target="_blank" rel="noopener noreferrer">
                Portafolio
              </a>
            )}
          </div>
        </section>

        <section className="card">
          <h2>Tutorías que ofrece</h2>
          <div className="stack" style={{ gap: '0.75rem' }}>
            {offers.length === 0 && <span className="muted">Sin ofertas publicadas.</span>}
            {offers.map((o) => (
              <div key={o.id} style={{ borderBottom: '1px solid #e3e6ef', paddingBottom: '0.75rem' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{o.title}</strong>
                  <strong>{money(o.hourly_rate)}/h</strong>
                </div>
                <div className="muted small">{o.description}</div>
                <div className="tags">
                  <span className="badge">{o.category_name}</span>
                  {o.modalities.map((m) => (
                    <span key={m} className="badge badge--completed">
                      {MODALITY_LABEL[m]}
                    </span>
                  ))}
                  {o.km_rate > 0 && <span className="badge badge--pending">Traslado {money(o.km_rate)}/km</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Disponibilidad semanal</h2>
          {availability.length === 0 ? (
            <span className="muted">Aún no ha configurado su disponibilidad.</span>
          ) : (
            <div className="grid grid--2" style={{ gap: '0.4rem 1rem' }}>
              {byDay.map((d) => (
                <div key={d.name} className="small">
                  <strong>{d.name}:</strong>{' '}
                  {d.blocks.length ? d.blocks.map((b) => `${minutesToLabel(b.start_min)}–${minutesToLabel(b.end_min)}`).join(', ') : <span className="muted">—</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2>Reseñas ({tutor.rating_count})</h2>
          {reviews.length === 0 && <span className="muted">Todavía no tiene reseñas.</span>}
          {reviews.map((r) => (
            <div key={r.id} style={{ borderBottom: '1px solid #e3e6ef', padding: '0.6rem 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong className="small">{r.student_name}</strong>
                <span className="stars">{'★'.repeat(r.rating)}</span>
              </div>
              {r.comment && <div className="small">{r.comment}</div>}
            </div>
          ))}
        </section>
      </div>

      {user?.role === 'student' && (
        <BookingPanel
          tutorId={tutor.id}
          tutorName={tutor.name}
          tutorLoc={tutor.lat != null && tutor.lng != null ? { lat: tutor.lat, lng: tutor.lng } : null}
          offers={offers}
        />
      )}
    </div>
  );
}
