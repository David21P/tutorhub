import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { ResultsMap } from '../components/maps';
import { Avatar, Empty, Spinner, Stars } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useDebounced } from '../hooks/useDebounced';
import { Category, TutorCard } from '../types';
import { MODALITY_LABEL, kmLabel, money } from '../utils/format';

interface Filters {
  q: string;
  category_id: string;
  modality: string;
  radius_km: string;
  min_price: string;
  max_price: string;
  min_rating: string;
  min_reviews: string;
  sort: string;
}

const EMPTY: Filters = { q: '', category_id: '', modality: '', radius_km: '', min_price: '', max_price: '', min_rating: '', min_reviews: '', sort: '' };

export default function Search() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tutors, setTutors] = useState<TutorCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const debounced = useDebounced(filters);

  useEffect(() => {
    api.get<{ categories: Category[] }>('/categories').then((r) => setCategories(r.data.categories)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(debounced)) if (v !== '') params[k] = v;
    if (user?.lat != null && user.lng != null) {
      params.lat = user.lat;
      params.lng = user.lng;
    }
    let cancelled = false;
    setError(null);
    api
      .get<{ tutors: TutorCard[] }>('/tutors/search', { params })
      .then((r) => !cancelled && setTutors(r.data.tutors))
      .catch((err) => {
        if (!cancelled) {
          setTutors([]);
          setError(errorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, user?.lat, user?.lng]);

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const parents = useMemo(() => categories.filter((c) => c.parent_id === null), [categories]);
  const activeCount = Object.values(filters).filter(Boolean).length;
  const me = user?.lat != null && user.lng != null ? { lat: user.lat, lng: user.lng } : null;

  return (
    <div className="grid grid--sidebar">
      <aside className="filters">
        <button className="btn btn--secondary btn--block filters__toggle" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filtros {activeCount > 0 && `(${activeCount})`}
        </button>
        <div className={`filters__body${showFilters ? ' is-open' : ''}`}>
          <h3 style={{ marginTop: '0.75rem' }}>Filtros</h3>
          <div className="field">
            <label className="label">Buscar</label>
            <input type="search" placeholder="Materia, tutor…" value={filters.q} onChange={set('q')} />
          </div>
          <div className="field">
            <label className="label">Categoría</label>
            <select value={filters.category_id} onChange={set('category_id')}>
              <option value="">Todas</option>
              {parents.map((p) => (
                <optgroup key={p.id} label={p.name}>
                  <option value={p.id}>Todo {p.name}</option>
                  {categories.filter((c) => c.parent_id === p.id).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">Modalidad</label>
            <select value={filters.modality} onChange={set('modality')}>
              <option value="">Todas</option>
              <option value="virtual">Virtual</option>
              <option value="presencial">Presencial (cualquiera)</option>
              <option value="tutor_home">En casa del tutor</option>
              <option value="student_home">En mi domicilio</option>
            </select>
          </div>
          <div className="field">
            <label className="label">Radio de cercanía (km)</label>
            <input type="number" min={1} max={500} placeholder="Sin límite" value={filters.radius_km} onChange={set('radius_km')} disabled={!me} />
            <span className="field__hint">{me ? 'Desde su ubicación registrada. Aplica a clases presenciales.' : 'Registre su ubicación en su perfil.'}</span>
          </div>
          <div className="form-grid" style={{ gap: '0 0.5rem' }}>
            <div className="field">
              <label className="label">Precio mín. (Q)</label>
              <input type="number" min={0} value={filters.min_price} onChange={set('min_price')} />
            </div>
            <div className="field">
              <label className="label">Precio máx. (Q)</label>
              <input type="number" min={0} value={filters.max_price} onChange={set('max_price')} />
            </div>
            <div className="field">
              <label className="label">Calificación mín.</label>
              <select value={filters.min_rating} onChange={set('min_rating')}>
                <option value="">Cualquiera</option>
                {[4.5, 4, 3, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}+ ★
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">Reseñas mín.</label>
              <input type="number" min={0} value={filters.min_reviews} onChange={set('min_reviews')} />
            </div>
          </div>
          <div className="field">
            <label className="label">Ordenar por</label>
            <select value={filters.sort} onChange={set('sort')}>
              <option value="">Recomendado</option>
              <option value="distance">Cercanía</option>
              <option value="rating">Calificación</option>
              <option value="price_asc">Precio: menor a mayor</option>
              <option value="price_desc">Precio: mayor a menor</option>
            </select>
          </div>
          <button className="btn btn--secondary btn--block" onClick={() => setFilters(EMPTY)}>
            Limpiar filtros
          </button>
        </div>
      </aside>

      <section className="stack">
        <div className="page-head">
          <div>
            <h1>Buscar tutores</h1>
            <p className="muted">{tutors ? `${tutors.length} resultado(s)` : 'Buscando…'}</p>
          </div>
          <div className="row">
            <button className={`btn btn--sm ${view === 'list' ? '' : 'btn--secondary'}`} onClick={() => setView('list')}>
              Lista
            </button>
            <button className={`btn btn--sm ${view === 'map' ? '' : 'btn--secondary'}`} onClick={() => setView('map')}>
              Mapa
            </button>
          </div>
        </div>
        {error && <div className="alert alert--error">{error}</div>}
        {tutors === null && <Spinner />}
        {tutors && tutors.length === 0 && !error && <Empty>No encontramos tutores con esos filtros. Pruebe ampliando la búsqueda.</Empty>}
        {tutors && tutors.length > 0 && view === 'map' && (
          <ResultsMap me={me} tutors={tutors.map((t) => ({ id: t.tutor_id, name: t.tutor_name, lat: t.lat, lng: t.lng }))} onOpen={(id) => navigate(`/tutor/${id}`)} />
        )}
        {tutors?.map((t) => (
          <Link key={t.tutor_id} to={`/tutor/${t.tutor_id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <article className="card card--link tutor-card">
              <Avatar name={t.tutor_name} url={t.photo_url} large />
              <div className="tutor-card__body">
                <div className="tutor-card__name">{t.tutor_name}</div>
                <Stars value={t.rating_avg} count={t.rating_count} />
                <div className="tutor-card__bio">{t.bio}</div>
                <div className="tags">
                  {t.offers.slice(0, 3).map((o) => (
                    <span key={o.id} className="badge">
                      {o.category_name}
                    </span>
                  ))}
                  {[...new Set(t.offers.flatMap((o) => o.modalities))].map((m) => (
                    <span key={m} className="badge badge--completed">
                      {MODALITY_LABEL[m]}
                    </span>
                  ))}
                </div>
              </div>
              <div className="tutor-card__price">
                <span className="muted small">desde</span>
                <strong>{money(t.min_rate)}</strong>
                <span className="muted small">por hora</span>
                <div className="small" style={{ marginTop: 6 }}>
                  📍 {kmLabel(t.distance_km)}
                </div>
              </div>
            </article>
          </Link>
        ))}
      </section>
    </div>
  );
}
