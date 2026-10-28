import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { useEventProducts, useEventTasks, useProducts, useSpend } from '../../hooks/data';
import { Button, EmptyState, IconButton, Loading } from '../../components/ui';
import { TextInput } from '../../components/form';
import { peso, sum } from '../../lib/money';
import { SECTIONS, SECTION_LABEL, readiness } from '../../domain/plan';
import { addStarterTasks, addTask, deleteTask, setTaskDone } from '../../services/plan';
import type { EventTask, JWEvent, TaskSection } from '../../db/types';

/** The event's checklist and packing list, with what stock to bring and what's still to buy. */
export default function PlanTab({ ev }: { ev: JWEvent }) {
  const app = useApp();
  const tasks = useEventTasks(ev.id);
  if (!tasks) return <Loading />;
  if (!tasks.length) {
    return (
      <EmptyState
        icon={<ListChecks size={44} />}
        title="No checklist yet"
        action={
          <Button variant="primary" onClick={() => addStarterTasks(ev.id)}>
            Add the JoshWorks starter checklist
          </Button>
        }
      >
        What to do before the event, what to pack, the day itself and after. Edit it to fit this event.
      </EmptyState>
    );
  }
  const r = readiness(tasks);
  return (
    <div className="plan-layout">
      <div className="stack loose">
        <div className="card">
          <div className="row between wrap">
            <h2>Ready for {ev.name}?</h2>
            <b>
              {r.done} of {r.total} done
            </b>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct} aria-label="Checklist done">
            <span style={{ width: `${r.pct}%` }} />
          </div>
        </div>
        {SECTIONS.map((section) => (
          <TaskList key={section} eventId={ev.id} section={section} tasks={tasks.filter((t) => t.section === section)} by={app.member?.id ?? null} />
        ))}
      </div>
      <aside className="stack">
        <StockToBring ev={ev} />
        {app.can('spend') ? <StillToBuy ev={ev} /> : null}
      </aside>
    </div>
  );
}

function TaskList({ eventId, section, tasks, by }: { eventId: string; section: TaskSection; tasks: EventTask[]; by: string | null }) {
  const [text, setText] = useState('');
  // A tick shows at once and stays while it saves (the list refreshes a moment later).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setPending((cur) => {
      const left = Object.fromEntries(Object.entries(cur).filter(([id, v]) => tasks.find((t) => t.id === id)?.done !== (v ? 1 : 0)));
      return Object.keys(left).length === Object.keys(cur).length ? cur : left;
    });
  }, [tasks]);
  const isDone = (t: EventTask) => pending[t.id] ?? t.done === 1;
  const done = tasks.filter(isDone).length;
  const add = async () => {
    if (!text.trim()) return;
    await addTask(eventId, section, text);
    setText('');
  };
  return (
    <section className="card" aria-labelledby={`plan-${section}`}>
      <div className="row between">
        <h3 id={`plan-${section}`}>{SECTION_LABEL[section]}</h3>
        <span className="muted small">
          {done}/{tasks.length}
        </span>
      </div>
      <ul className="task-list">
        {tasks.map((t) => (
          <li key={t.id} className={isDone(t) ? 'done' : ''}>
            <label className="check" htmlFor={`task-${t.id}`}>
              <input
                id={`task-${t.id}`}
                type="checkbox"
                checked={isDone(t)}
                onChange={(e) => {
                  const v = e.target.checked;
                  setPending((cur) => ({ ...cur, [t.id]: v }));
                  void setTaskDone(t.id, v, by);
                }}
              />
              <span>
                {t.text}
                {t.qty ? <span className="muted"> × {t.qty}</span> : null}
              </span>
            </label>
            <IconButton label={`Remove “${t.text}”`} size="sm" plain onClick={() => deleteTask(t.id)}>
              <Trash2 size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="row">
        <TextInput
          aria-label={`Add to ${SECTION_LABEL[section]}`}
          placeholder="Add an item"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <IconButton label={`Add to ${SECTION_LABEL[section]}`} onClick={add} disabled={!text.trim()}>
          <Plus size={18} />
        </IconButton>
      </div>
    </section>
  );
}

function StockToBring({ ev }: { ev: JWEvent }) {
  const eps = useEventProducts(ev.id);
  const products = useProducts();
  if (!eps || !products) return null;
  const name = new Map(products.map((p) => [p.id, p.name]));
  const rows = eps.filter((e) => (e.stockBrought ?? 0) > 0).sort((a, b) => (b.stockBrought ?? 0) - (a.stockBrought ?? 0));
  return (
    <div className="card">
      <div className="row between">
        <h3>Stock to bring</h3>
        <Link to="/event/stock" className="small strong">
          Stock
        </Link>
      </div>
      {rows.length ? (
        <>
          <p className="muted small">{sum(rows.map((r) => r.stockBrought ?? 0))} pieces across {rows.length} products.</p>
          <ul className="plain-list small">
            {rows.slice(0, 30).map((r) => (
              <li key={r.id} className="row between">
                <span>{name.get(r.productId) ?? 'Product'}</span>
                <b>{r.stockBrought}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small">Count what you’re bringing in the Stock tab; it shows here as the packing list for merch.</p>
      )}
    </div>
  );
}

function StillToBuy({ ev }: { ev: JWEvent }) {
  const spend = useSpend(ev.id);
  if (!spend) return null;
  const toBuy = spend.filter((s) => s.status === 'to_buy');
  return (
    <div className="card">
      <div className="row between">
        <h3>Still to buy</h3>
        <Link to="/event/spend" className="small strong">
          Booth spend
        </Link>
      </div>
      {toBuy.length ? (
        <>
          <ul className="plain-list small">
            {toBuy.map((s) => (
              <li key={s.id} className="row between">
                <span>
                  {s.name}
                  {s.qty > 1 ? <span className="muted"> × {s.qty}</span> : null}
                </span>
                <b>{peso(Math.round(s.qty * s.unitCost))}</b>
              </li>
            ))}
          </ul>
          <p className="small strong">{peso(sum(toBuy.map((s) => Math.round(s.qty * s.unitCost))))} to spend</p>
        </>
      ) : (
        <p className="muted small">Nothing planned. Add purchases in Booth spend with the status “To buy”.</p>
      )}
    </div>
  );
}
