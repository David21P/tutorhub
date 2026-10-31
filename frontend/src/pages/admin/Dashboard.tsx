import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, errorMessage } from '../../api/client';
import { Empty, Spinner } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useDebounced } from '../../hooks/useDebounced';

interface Ranked {
  id: string;
  name: string;
  rating_avg: number;
  rating_count: number;
}
interface Stats {
  best_tutors: Ranked[];
  worst_tutors: Ranked[];
  hours_by_category: { id: number; name: string; parent_name: string | null; hours: number; sessions: number }[];
  sessions_by_month: { month: string; taught: number; cancelled: number }[];
  totals: Record<string, number>;
}

const TOTAL_LABELS: [string, string][] = [
  ['students', 'Estudiantes'],
  ['tutors', 'Tutores'],
  ['pending_tutors', 'Tutores por aprobar'],
  ['completed_sessions', 'Sesiones cumplidas'],
  ['open_reports', 'Reportes abiertos'],
  ['pending_appeals', 'Apelaciones pendientes'],
  ['suspended_users', 'Cuentas suspendidas'],
];

const C = { primary: '#4f46e5', accent: '#0d9488', danger: '#dc2626', grid: '#e3e6ef' };

function RankList({ title, items }: { title: string; items: Ranked[] }) {
  return (
    <div className="chart-card">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <Empty>Sin reseñas suficientes.</Empty>
      ) : (
        <ol className="ranking">
          {items.map((t, i) => (
            <li key={t.id}>
              <span>
                {i + 1}. {t.name}
              </span>
              <span className="nowrap">
                <strong>★ {t.rating_avg.toFixed(2)}</strong> <span className="muted small">({t.rating_count} reseñas)</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Panel de analítica con gráficas dinámicas filtrables por fecha y cantidad mínima de reseñas. */
export default function Dashboard() {
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minReviews, setMinReviews] = useState(1);
  const [top, setTop] = useState(5);
  const query = useDebounced({ from, to, minReviews, top });

  useEffect(() => {
    const params: Record<string, string | number> = { min_reviews: query.minReviews, top: query.top };
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;
    api
      .get<Stats>('/admin/stats', { params })
      .then((r) => setStats(r.data))
      .catch((e) => toast.error(errorMessage(e)));
  }, [query, toast]);

  if (!stats) return <Spinner />;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Panel de administración</h1>
      </div>
      <div className="grid grid--3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {TOTAL_LABELS.map(([k, label]) => (
          <div key={k} className="stat">
            <div className="stat__value">{stats.totals[k] ?? 0}</div>
            <div className="stat__label">{label}</div>
          </div>
        ))}
      </div>

      <section className="card">
        <h3>Filtros de las gráficas</h3>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <div className="field">
            <label className="label">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Reseñas mínimas (ranking)</label>
            <input type="number" min={1} value={minReviews} onChange={(e) => setMinReviews(Math.max(1, Number(e.target.value)))} />
          </div>
          <div className="field">
            <label className="label">Tutores en el ranking</label>
            <select value={top} onChange={(e) => setTop(Number(e.target.value))}>
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="grid grid--2">
        <RankList title="🏆 Mejores tutores" items={stats.best_tutors} />
        <RankList title="⚠️ Tutores con menor calificación" items={stats.worst_tutors} />
      </div>

      <div className="grid grid--2">
        <div className="chart-card">
          <h3>Horas contratadas por categoría</h3>
          {stats.hours_by_category.length === 0 ? (
            <Empty>Sin datos en el periodo.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, stats.hours_by_category.length * 38)}>
              <BarChart data={stats.hours_by_category} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`${String(v)} h`, "Horas"]} />
                <Bar dataKey="hours" name="Horas" fill={C.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="chart-card">
          <h3>Sesiones dictadas vs. canceladas por mes</h3>
          {stats.sessions_by_month.length === 0 ? (
            <Empty>Sin datos en el periodo.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stats.sessions_by_month} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="taught" name="Dictadas" fill={C.accent} radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" name="Canceladas" fill={C.danger} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
