import esLocale from '@fullcalendar/core/locales/es';
import { DatesSetArg, EventClickArg } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxon3Plugin from '@fullcalendar/luxon3';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useCallback, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';
import { BookingDetail } from '../components/BookingDetail';
import { useAuth } from '../context/AuthContext';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { useToast } from '../context/ToastContext';
import { Booking } from '../types';
import { TZ } from '../utils/format';

const COLORS: Record<string, string> = {
  pending: '#d97706',
  approved: '#16a34a',
  completed: '#0d9488',
  cancelled: '#9ca3af',
  rejected: '#dc2626',
};
const LABEL: Record<string, string> = { pending: 'Pendiente', approved: 'Aprobada', completed: 'Cumplida', cancelled: 'Cancelada', rejected: 'Rechazada' };

/** Calendario con vistas de día, semana y mes. */
export default function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const range = useRef<{ from: string; to: string } | null>(null);
  const isTutor = user?.role === 'tutor';

  const load = useCallback(async () => {
    if (!range.current) return;
    try {
      const { data } = await api.get<{ bookings: Booking[] }>('/bookings', { params: range.current });
      setBookings(data.bookings);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [toast]);

  useLiveRefresh(() => void load());

  const onDates = (arg: DatesSetArg) => {
    range.current = { from: arg.start.toISOString(), to: arg.end.toISOString() };
    void load();
  };

  const events = useMemo(
    () =>
      bookings
        .filter((b) => b.status !== 'rejected')
        .map((b) => ({
          id: b.id,
          title: `${isTutor ? b.student_name : b.tutor_name} · ${b.offer_title}`,
          start: b.starts_at,
          end: b.ends_at,
          backgroundColor: COLORS[b.status],
          borderColor: COLORS[b.status],
          extendedProps: { status: b.status },
        })),
    [bookings, isTutor],
  );

  const onClick = (arg: EventClickArg) => {
    const found = bookings.find((b) => b.id === arg.event.id);
    if (found) setSelected(found);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Calendario</h1>
      </div>
      <div className="legend">
        {Object.entries(LABEL).map(([k, v]) => (
          <span key={k} style={{ ['--c' as string]: COLORS[k] }}>
            {v}
          </span>
        ))}
      </div>
      <div className="calendar-wrap">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxon3Plugin]}
          initialView={window.innerWidth < 768 ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          locale={esLocale}
          timeZone={TZ}
          events={events}
          datesSet={onDates}
          eventClick={onClick}
          height="auto"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          nowIndicator
          firstDay={1}
        />
      </div>
      {selected && <BookingDetail booking={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    </div>
  );
}
