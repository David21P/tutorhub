import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { Empty, Field, Modal, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Category, Modality, OfferSummary } from '../types';
import { MODALITY_LABEL, money } from '../utils/format';

interface Draft {
  id?: string;
  category_id: string;
  title: string;
  description: string;
  modalities: Modality[];
  hourly_rate: string;
  km_rate: string;
  active: boolean;
}

const blank = (rate: number): Draft => ({ category_id: '', title: '', description: '', modalities: ['virtual'], hourly_rate: String(rate), km_rate: '0', active: true });

export default function Offers() {
  const { user } = useAuth();
  const toast = useToast();
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const approved = user?.tutor?.approval_status === 'approved';

  const load = useCallback(() => {
    api.get<{ offers: OfferSummary[] }>('/offers/mine').then((r) => setOffers(r.data.offers)).catch((e) => toast.error(errorMessage(e)));
  }, [toast]);
  useEffect(() => {
    load();
    api.get<{ categories: Category[] }>('/categories').then((r) => setCategories(r.data.categories)).catch(() => undefined);
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const body = {
      category_id: Number(draft.category_id),
      title: draft.title,
      description: draft.description,
      modalities: draft.modalities,
      hourly_rate: Number(draft.hourly_rate),
      km_rate: Number(draft.km_rate),
      active: draft.active,
    };
    try {
      if (draft.id) await api.put(`/offers/${draft.id}`, body);
      else await api.post('/offers', body);
      toast.success('Oferta guardada.');
      setDraft(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggleModality = (m: Modality) =>
    setDraft((d) => (d ? { ...d, modalities: d.modalities.includes(m) ? d.modalities.filter((x) => x !== m) : [...d.modalities, m] } : d));

  const leaves = categories.filter((c) => c.parent_id !== null);
  const parentName = (id: number | null) => categories.find((c) => c.id === id)?.name;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Mis ofertas</h1>
          <p className="muted">Las tutorías que publica para que los estudiantes las encuentren.</p>
        </div>
        <button className="btn" disabled={!approved} onClick={() => setDraft(blank(user?.tutor?.hourly_rate ?? 0))}>
          + Nueva oferta
        </button>
      </div>
      {!approved && <div className="alert alert--warn">Podrá publicar ofertas cuando un administrador apruebe su perfil de tutor.</div>}
      {offers === null && <Spinner />}
      {offers?.length === 0 && <Empty>Aún no ha publicado ofertas.</Empty>}
      <div className="grid grid--2">
        {offers?.map((o) => (
          <article key={o.id} className="card" style={{ opacity: o.active ? 1 : 0.6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{o.title}</strong>
              <strong>{money(o.hourly_rate)}/h</strong>
            </div>
            <p className="muted small">{o.description}</p>
            <div className="tags">
              <span className="badge">{o.category_name}</span>
              {o.modalities.map((m) => (
                <span key={m} className="badge badge--completed">
                  {MODALITY_LABEL[m]}
                </span>
              ))}
              {o.km_rate > 0 && <span className="badge badge--pending">{money(o.km_rate)}/km</span>}
              {!o.active && <span className="badge badge--cancelled">Inactiva</span>}
            </div>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => setDraft({ id: o.id, category_id: String(o.category_id), title: o.title, description: o.description ?? '', modalities: o.modalities, hourly_rate: String(o.hourly_rate), km_rate: String(o.km_rate), active: o.active ?? true })}
            >
              Editar
            </button>
          </article>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? 'Editar oferta' : 'Nueva oferta'} onClose={() => setDraft(null)}>
          <form onSubmit={(e) => void save(e)}>
            <Field label="Título">
              <input type="text" required minLength={5} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Categoría">
              <select required value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}>
                <option value="">Seleccione…</option>
                {leaves.map((c) => (
                  <option key={c.id} value={c.id}>
                    {parentName(c.parent_id)} › {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Descripción">
              <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <div className="field">
              <span className="label">Modalidades</span>
              <div className="checks">
                {(Object.keys(MODALITY_LABEL) as Modality[]).map((m) => (
                  <label key={m} className={`chip${draft.modalities.includes(m) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={draft.modalities.includes(m)} onChange={() => toggleModality(m)} />
                    {m === 'student_home' ? 'Voy al domicilio del estudiante' : MODALITY_LABEL[m]}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <Field label="Tarifa por hora (Q)">
                <input type="number" required min={0} step="0.01" value={draft.hourly_rate} onChange={(e) => setDraft({ ...draft, hourly_rate: e.target.value })} />
              </Field>
              <Field label="Tarifa por km de traslado (Q)" hint="Solo se cobra cuando va al domicilio del estudiante.">
                <input type="number" min={0} step="0.01" value={draft.km_rate} onChange={(e) => setDraft({ ...draft, km_rate: e.target.value })} />
              </Field>
            </div>
            {draft.id && (
              <label className="row small">
                <input type="checkbox" style={{ width: 'auto' }} checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Oferta activa (visible en búsquedas)
              </label>
            )}
            <div className="row" style={{ marginTop: '1rem' }}>
              <button className="btn" type="submit" disabled={draft.modalities.length === 0}>
                Guardar
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => setDraft(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
