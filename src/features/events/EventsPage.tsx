import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarDays, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../../app/AppContext';
import { useEvents } from '../../hooks/data';
import { db } from '../../db/db';
import { Badge, Button, EmptyState, IconButton, PageHeader } from '../../components/ui';
import { EventFormDialog, DuplicateEventDialog } from './EventFormDialog';
import { deleteEvent, EVENT_STATUS_LABEL } from '../../services/events';
import { peso } from '../../lib/money';
import { fmtDateRange } from '../../lib/time';
import type { JWEvent } from '../../db/types';

export default function EventsPage() {
  const app = useApp();
  const navigate = useNavigate();
  const events = useEvents();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JWEvent | null>(null);
  const [dupFrom, setDupFrom] = useState<JWEvent | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const totals = useLiveQuery(async () => {
    const m = new Map<string, { gross: number; count: number }>();
    await db.sales.each((s) => {
      if (s.deleted === 1 || s.status !== 'completed') return;
      const v = m.get(s.eventId) ?? { gross: 0, count: 0 };
      v.gross += s.total;
      v.count += 1;
      m.set(s.eventId, v);
    });
    return m;
  }, []);

  const groups = useMemo(() => {
    const list = events ?? [];
    return [
      { title: 'Live and upcoming', items: list.filter((e) => e.status === 'live' || e.status === 'planning') },
      { title: 'Past events', items: list.filter((e) => e.status === 'closed' || e.status === 'reported') },
    ].filter((g) => g.items.length);
  }, [events]);

  const open = (ev: JWEvent) => {
    app.setActiveEventId(ev.id);
    navigate('/event');
  };

  const remove = async (ev: JWEvent) => {
    if (!(await app.confirm({ title: `Delete ${ev.name}?`, message: 'The event and its settings are removed. This only works for events with no sales.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteEvent(ev.id);
      app.toast('Event deleted', { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Could not delete the event', { tone: 'bad' });
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Events"
        subtitle="Each event keeps its own prices, sales, booth spend, team and report."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={18} /> New event
          </Button>
        }
      />
      {events && events.length === 0 ? (
        <EmptyState
          icon={<CalendarDays size={48} />}
          title="No events yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first event
            </Button>
          }
        >
          Create the event you&rsquo;re preparing for. You can set prices, team and booth spend before the day.
        </EmptyState>
      ) : null}
      {groups.map((g) => (
        <section key={g.title} className="stack">
          <h2>{g.title}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th className="hide-phone">Dates</th>
                  <th>Status</th>
                  <th className="r">Sales</th>
                  <th className="r"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((ev) => {
                  const t = totals?.get(ev.id);
                  return (
                    <tr key={ev.id} className="click" onClick={() => open(ev)}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <b>{ev.name}</b>
                          {ev.id === app.activeEventId ? <Badge tone="yellow">Active</Badge> : null}
                        </div>
                        <div className="muted small">
                          <span className="show-phone">{fmtDateRange(ev.startDate, ev.endDate)} · </span>
                          {ev.venue || ev.organizer || '—'}
                        </div>
                      </td>
                      <td className="hide-phone nowrap">{fmtDateRange(ev.startDate, ev.endDate)}</td>
                      <td>
                        <Badge tone={ev.status === 'live' ? 'good' : ev.status === 'planning' ? 'teal' : undefined}>{EVENT_STATUS_LABEL[ev.status]}</Badge>
                      </td>
                      <td className="r">
                        {t ? (
                          <>
                            <b>{peso(t.gross)}</b>
                            <div className="muted tiny">{t.count} sales</div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="r" onClick={(e) => e.stopPropagation()}>
                        <div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <IconButton label="Edit details" size="sm" onClick={() => setEditing(ev)}>
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton label="New event from this one" size="sm" onClick={() => setDupFrom(ev)}>
                            <Copy size={16} />
                          </IconButton>
                          {!t ? (
                            <IconButton label="Delete event" size="sm" onClick={() => remove(ev)}>
                              <Trash2 size={16} />
                            </IconButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <EventFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(ev) => {
          app.setActiveEventId(ev.id);
          app.toast(`${ev.name} created. Next: set prices for it.`, { tone: 'good' });
          navigate('/event/prices');
        }}
      />
      <EventFormDialog open={!!editing} event={editing} onClose={() => setEditing(null)} />
      <DuplicateEventDialog
        source={dupFrom}
        onClose={() => setDupFrom(null)}
        onDone={(ev) => {
          app.setActiveEventId(ev.id);
          app.toast(`${ev.name} created`, { tone: 'good' });
          navigate('/event');
        }}
      />
    </div>
  );
}
