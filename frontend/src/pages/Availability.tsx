import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { AvailabilityGrid } from '../components/AvailabilityGrid';
import { Spinner } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { AvailabilityBlock } from '../types';

export default function Availability() {
  const toast = useToast();
  const [saved, setSaved] = useState<AvailabilityBlock[] | null>(null);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ blocks: AvailabilityBlock[] }>('/availability/mine')
      .then((r) => {
        setSaved(r.data.blocks);
        setBlocks(r.data.blocks);
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put<{ blocks: AvailabilityBlock[] }>('/availability/mine', { blocks });
      setSaved(r.data.blocks);
      toast.success('Disponibilidad guardada.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!saved) return <Spinner />;
  const dirty = JSON.stringify(saved) !== JSON.stringify(blocks);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Disponibilidad semanal</h1>
          <p className="muted">Marque con clic o arrastrando los bloques de 30 minutos en los que puede dar clases. Los estudiantes solo verán horarios dentro de esta cuadrícula.</p>
        </div>
        <button className="btn" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
      <div className="card">
        <AvailabilityGrid value={saved} onChange={setBlocks} />
      </div>
    </div>
  );
}
