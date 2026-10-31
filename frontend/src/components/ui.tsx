import { ReactNode, useEffect } from 'react';
import { STATUS_LABEL } from '../utils/format';

export function Spinner() {
  return <div className="spinner" role="progressbar" aria-label="Cargando" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Avatar({ name, url, large }: { name: string; url?: string | null; large?: boolean }) {
  const cls = `avatar${large ? ' avatar--lg' : ''}`;
  if (url) return <img className={cls} src={url} alt={name} referrerPolicy="no-referrer" />;
  return (
    <span className={cls} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" title={`${value.toFixed(2)} de 5`}>
      {'★'.repeat(full)}
      <span style={{ color: '#d1d5db' }}>{'★'.repeat(5 - full)}</span>
      <span className="muted small" style={{ marginLeft: 6 }}>
        {count === 0 || (count !== undefined && value === 0) ? 'Sin reseñas' : `${value.toFixed(1)}${count !== undefined ? ` (${count})` : ''}`}
      </span>
    </span>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          type="button"
          key={n}
          className={`stars__btn${n <= value ? ' is-on' : ''}`}
          onClick={() => onChange(n)}
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} estrellas`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}
