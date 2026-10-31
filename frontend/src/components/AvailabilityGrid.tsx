import { useCallback, useEffect, useRef, useState } from 'react';
import { AvailabilityBlock } from '../types';
import { WEEKDAYS_SHORT, minutesToLabel } from '../utils/format';

const START_HOUR = 6;
const END_HOUR = 22;
const SLOTS = (END_HOUR - START_HOUR) * 2; // bloques de 30 min

const keyOf = (weekday: number, slot: number) => `${weekday}-${slot}`;

function blocksToCells(blocks: AvailabilityBlock[]): Set<string> {
  const cells = new Set<string>();
  for (const b of blocks) {
    for (let m = b.start_min; m < b.end_min; m += 30) {
      const slot = (m - START_HOUR * 60) / 30;
      if (slot >= 0 && slot < SLOTS) cells.add(keyOf(b.weekday, slot));
    }
  }
  return cells;
}

export function cellsToBlocks(cells: Set<string>): AvailabilityBlock[] {
  const blocks: AvailabilityBlock[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    let start: number | null = null;
    for (let slot = 0; slot <= SLOTS; slot += 1) {
      const on = slot < SLOTS && cells.has(keyOf(weekday, slot));
      if (on && start === null) start = slot;
      if (!on && start !== null) {
        blocks.push({ weekday, start_min: START_HOUR * 60 + start * 30, end_min: START_HOUR * 60 + slot * 30 });
        start = null;
      }
    }
  }
  return blocks;
}

interface Props {
  value: AvailabilityBlock[];
  onChange: (blocks: AvailabilityBlock[]) => void;
}

/** Cuadrícula semanal: clic o arrastre para activar/desactivar bloques de 30 minutos. */
export function AvailabilityGrid({ value, onChange }: Props) {
  const [cells, setCells] = useState<Set<string>>(() => blocksToCells(value));
  const dragMode = useRef<'on' | 'off' | null>(null);
  const first = useRef(true);

  useEffect(() => {
    setCells(blocksToCells(value));
  }, [value]);

  const commit = useCallback(
    (next: Set<string>) => {
      setCells(next);
      onChange(cellsToBlocks(next));
    },
    [onChange],
  );

  const apply = (weekday: number, slot: number) => {
    if (!dragMode.current) return;
    const k = keyOf(weekday, slot);
    const next = new Set(cells);
    if (dragMode.current === 'on') next.add(k);
    else next.delete(k);
    if (next.size !== cells.size) commit(next);
  };

  useEffect(() => {
    const up = () => {
      dragMode.current = null;
    };
    window.addEventListener('pointerup', up);
    first.current = false;
    return () => window.removeEventListener('pointerup', up);
  }, []);

  return (
    <div className="avail">
      <table className="avail__table">
        <thead>
          <tr>
            <th />
            {WEEKDAYS_SHORT.map((d) => (
              <th key={d}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: SLOTS }, (_, slot) => (
            <tr key={slot}>
              <td className="time">{slot % 2 === 0 ? minutesToLabel(START_HOUR * 60 + slot * 30) : ''}</td>
              {WEEKDAYS_SHORT.map((_, i) => {
                const weekday = i + 1;
                const on = cells.has(keyOf(weekday, slot));
                return (
                  <td
                    key={weekday}
                    className={`avail__cell${on ? ' is-on' : ''}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      dragMode.current = on ? 'off' : 'on';
                      apply(weekday, slot);
                    }}
                    onPointerEnter={() => apply(weekday, slot)}
                    aria-label={`${WEEKDAYS_SHORT[i]} ${minutesToLabel(START_HOUR * 60 + slot * 30)}`}
                    aria-pressed={on}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
