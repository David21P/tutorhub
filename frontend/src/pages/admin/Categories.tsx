import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Spinner } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { Category } from '../../types';

export default function Categories() {
  const toast = useToast();
  const [list, setList] = useState<Category[] | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(() => {
    api.get<{ categories: Category[] }>('/categories').then((r) => setList(r.data.categories)).catch((e) => toast.error(errorMessage(e)));
  }, [toast]);
  useEffect(load, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/admin/categories', { name, parent_id: parentId ? Number(parentId) : null });
      setName('');
      toast.success('Categoría creada.');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const rename = async (c: Category, newName: string, active = c.active) => {
    try {
      await api.put(`/admin/categories/${c.id}`, { name: newName, active });
      setEditing(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const remove = async (c: Category) => {
    if (!window.confirm(`¿Eliminar "${c.name}"? Si tiene ofertas asociadas solo se desactivará.`)) return;
    try {
      const { data } = await api.delete<{ deleted: boolean; deactivated: boolean }>(`/admin/categories/${c.id}`);
      toast.success(data.deleted ? 'Categoría eliminada.' : 'La categoría tiene ofertas asociadas; fue desactivada.');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (!list) return <Spinner />;
  const parents = list.filter((c) => c.parent_id === null);

  const Row = ({ c, sub }: { c: Category; sub?: boolean }) => (
    <div className="row" style={{ padding: '0.4rem 0', paddingLeft: sub ? '1.5rem' : 0, borderBottom: '1px solid #e3e6ef', opacity: c.active ? 1 : 0.55 }}>
      {editing?.id === c.id ? (
        <>
          <input type="text" value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          <button className="btn btn--sm" onClick={() => void rename(c, editing.name)}>
            Guardar
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => setEditing(null)}>
            Cancelar
          </button>
        </>
      ) : (
        <>
          <strong style={{ flex: 1, fontWeight: sub ? 500 : 700 }}>
            {c.name} {!c.active && <span className="badge badge--cancelled">Inactiva</span>}
          </strong>
          <button className="btn btn--secondary btn--sm" onClick={() => setEditing({ id: c.id, name: c.name })}>
            Renombrar
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => void rename(c, c.name, !c.active)}>
            {c.active ? 'Desactivar' : 'Activar'}
          </button>
          <button className="btn btn--danger btn--sm" onClick={() => void remove(c)}>
            Eliminar
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Categorías y subcategorías</h1>
      </div>
      <form className="card row" onSubmit={(e) => void create(e)}>
        <input type="text" required minLength={2} placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Categoría principal</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              Subcategoría de {p.name}
            </option>
          ))}
        </select>
        <button className="btn">Agregar</button>
      </form>
      <div className="card">
        {parents.map((p) => (
          <div key={p.id} style={{ marginBottom: '0.75rem' }}>
            <Row c={p} />
            {list.filter((c) => c.parent_id === p.id).map((c) => (
              <Row key={c.id} c={c} sub />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
