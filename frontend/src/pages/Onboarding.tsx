import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { LocationPicker } from '../components/maps';
import { Field, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Category, User } from '../types';

type RoleChoice = 'student' | 'tutor';

interface FileInfo {
  id: string;
  filename: string;
}

async function upload(file: File, kind: 'cv' | 'identity'): Promise<FileInfo> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const { data } = await api.post<{ id: string; filename: string }>('/files', form);
  return { id: data.id, filename: data.filename };
}

/** Onboarding obligatorio (primera vez) y edición posterior del perfil. */
export default function Onboarding({ editing = false }: { editing?: boolean }) {
  const { user, setUser, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string | null>(null);

  const [role, setRole] = useState<RoleChoice | null>((user?.role === 'student' || user?.role === 'tutor' ? user.role : null) as RoleChoice | null);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [gender, setGender] = useState(user?.gender ?? '');
  const [address, setAddress] = useState(user?.address ?? '');
  const [lat, setLat] = useState<number | null>(user?.lat ?? null);
  const [lng, setLng] = useState<number | null>(user?.lng ?? null);
  const [docNumber, setDocNumber] = useState(user?.id_document_number ?? '');
  const [docFile, setDocFile] = useState<FileInfo | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[]>(user?.category_ids ?? []);
  const [bio, setBio] = useState(user?.tutor?.bio ?? '');
  const [rate, setRate] = useState<string>(user?.tutor ? String(user.tutor.hourly_rate) : '');
  const [portfolio, setPortfolio] = useState(user?.tutor?.portfolio_url ?? '');
  const [cvFile, setCvFile] = useState<FileInfo | null>(user?.tutor?.cv_file_id ? { id: user.tutor.cv_file_id, filename: 'Hoja de vida actual' } : null);

  useEffect(() => {
    api.get<{ categories: Category[] }>('/categories').then((r) => setCategories(r.data.categories)).catch(() => undefined);
  }, []);

  const parents = useMemo(() => categories.filter((c) => c.parent_id === null), [categories]);
  const toggleCategory = (id: number) => setCategoryIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const onFile = (kind: 'cv' | 'identity') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const info = await upload(file, kind);
      if (kind === 'cv') setCvFile(info);
      else setDocFile(info);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors(null);
    if (!role) return setErrors('Seleccione si es estudiante o tutor.');
    if (lat === null || lng === null) return setErrors('Marque su ubicación en el mapa.');
    setSaving(true);
    try {
      const body = {
        role, phone, gender, address, lat, lng,
        id_document_number: docNumber,
        id_document_file_id: docFile?.id ?? null,
        category_ids: categoryIds,
        ...(role === 'tutor'
          ? { tutor: { bio, hourly_rate: Number(rate), cv_file_id: cvFile?.id ?? null, portfolio_url: portfolio || null } }
          : {}),
      };
      const { data } = await api[editing ? 'put' : 'put']<{ user: User }>(editing ? '/users/me' : '/users/me/onboarding', body);
      setUser(data.user);
      await refresh();
      toast.success(editing ? 'Perfil actualizado.' : '¡Perfil completado! Bienvenido a TutorHub.');
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <Spinner />;

  return (
    <form className="stack" onSubmit={(e) => void submit(e)} style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <h1>{editing ? 'Mi perfil' : 'Complete su perfil'}</h1>
          {!editing && <p className="muted">Necesitamos algunos datos antes de que pueda usar la plataforma.</p>}
        </div>
      </div>
      {user.tutor && user.tutor.approval_status !== 'approved' && (
        <div className="alert alert--warn">
          {user.tutor.approval_status === 'pending'
            ? 'Su perfil de tutor está pendiente de aprobación por un administrador. Mientras tanto no aparecerá en las búsquedas ni podrá publicar ofertas.'
            : `Su perfil fue rechazado. ${user.tutor.approval_note ?? ''} Actualice su información para volver a ser evaluado.`}
        </div>
      )}
      {errors && <div className="alert alert--error">{errors}</div>}

      {!editing && (
        <section className="card">
          <h2>1. ¿Cómo usará TutorHub?</h2>
          <div className="grid grid--2">
            {(
              [
                ['student', 'Soy estudiante', 'Busco tutores para aprender.'],
                ['tutor', 'Soy tutor', 'Quiero ofrecer mis clases.'],
              ] as const
            ).map(([value, title, text]) => (
              <button
                type="button"
                key={value}
                className={`card card--link${role === value ? ' is-selected' : ''}`}
                style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', borderColor: role === value ? '#4f46e5' : undefined, borderWidth: role === value ? 2 : 1 }}
                onClick={() => setRole(value)}
                aria-pressed={role === value}
              >
                <strong>{title}</strong>
                <div className="muted small">{text}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>{editing ? 'Datos personales' : '2. Datos personales'}</h2>
        <div className="form-grid">
          <Field label="Teléfono / WhatsApp" hint="Con código de país, ej. +50255551234">
            <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Género">
            <select required value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Seleccione…</option>
              <option value="femenino">Femenino</option>
              <option value="masculino">Masculino</option>
              <option value="otro">Otro</option>
              <option value="prefiero_no_decir">Prefiero no decirlo</option>
            </select>
          </Field>
          <Field label="Documento de identificación (número)">
            <input type="text" required minLength={5} value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </Field>
          <Field label="Foto o PDF del documento" hint={docFile ? `Adjunto: ${docFile.filename}` : 'PDF, PNG o JPG · máx. 3 MB'}>
            <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void onFile('identity')(e)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>{editing ? 'Ubicación' : '3. Ubicación'}</h2>
        <Field label="Dirección" hint="Se usa para calcular distancias y el costo de traslado.">
          <input type="text" required minLength={5} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <LocationPicker
          lat={lat}
          lng={lng}
          onChange={(la, ln, addr) => {
            setLat(la);
            setLng(ln);
            if (addr && !address) setAddress(addr);
          }}
        />
      </section>

      <section className="card">
        <h2>{editing ? 'Categorías de interés' : '4. Categorías de interés'}</h2>
        <p className="muted small">{role === 'tutor' ? 'Áreas en las que enseña.' : 'Áreas en las que busca tutoría.'}</p>
        {parents.map((p) => (
          <div key={p.id} style={{ marginBottom: '0.75rem' }}>
            <strong className="small">{p.name}</strong>
            <div className="checks" style={{ marginTop: 4 }}>
              {categories
                .filter((c) => c.parent_id === p.id)
                .map((c) => (
                  <label key={c.id} className={`chip${categoryIds.includes(c.id) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                    {c.name}
                  </label>
                ))}
            </div>
          </div>
        ))}
      </section>

      {role === 'tutor' && (
        <section className="card">
          <h2>{editing ? 'Credenciales de tutor' : '5. Credenciales de tutor'}</h2>
          <Field label="Biografía profesional" hint="Mínimo 20 caracteres.">
            <textarea required minLength={20} value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Field label="Tarifa base por hora (Q)">
              <input type="number" required min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <span />
            <Field label="Hoja de vida (PDF)" hint={cvFile ? `Adjunto: ${cvFile.filename}` : 'Suba su CV o indique un portafolio'}>
              <input type="file" accept="application/pdf" onChange={(e) => void onFile('cv')(e)} />
            </Field>
            <Field label="URL de portafolio" hint="Alternativa a la hoja de vida">
              <input type="url" placeholder="https://" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} />
            </Field>
          </div>
        </section>
      )}

      <button className="btn" type="submit" disabled={saving}>
        {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Finalizar y continuar'}
      </button>
    </form>
  );
}
