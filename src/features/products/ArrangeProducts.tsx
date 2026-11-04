import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { Button, Callout, IconButton } from '../../components/ui';
import { mergeOrder, reorderProducts } from '../../services/catalog';
import type { Product } from '../../db/types';

/**
 * Arrange products by dragging the handle (finger, mouse or pen) or with the
 * arrows. The order is what Products and the register show, on every device.
 * Nothing is saved until Save order.
 */
export function ArrangeProducts({
  all,
  shown,
  catName,
  category,
  onDone,
}: {
  /** Every product, in the current order. */
  all: Product[];
  /** The ones being arranged (all, or one category). */
  shown: Product[];
  catName: Map<string, string>;
  /** The category being arranged, if only one. */
  category: string | null;
  onDone: () => void;
}) {
  const app = useApp();
  const byId = new Map(shown.map((p) => [p.id, p]));
  const [order, setOrder] = useState(() => shown.map((p) => p.id));
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // Live values for the pointer handlers (state updates arrive a render later).
  const orderRef = useRef(order);
  orderRef.current = order;
  const start = useRef<{ id: string; y: number; scroll: number } | null>(null);

  const scroller = () => document.getElementById('main') ?? document.scrollingElement ?? document.documentElement;
  const move = (from: number, to: number) => {
    if (to < 0 || to >= orderRef.current.length || from === to) return;
    const next = [...orderRef.current];
    const [id] = next.splice(from, 1);
    next.splice(to, 0, id);
    orderRef.current = next;
    setOrder(next);
  };
  const changed = order.some((id, i) => id !== shown[i]?.id);

  const onDown = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { id, y: e.clientY, scroll: scroller().scrollTop };
    setDrag({ id, dy: 0 });
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    const list = listRef.current;
    if (!s || !list) return;
    // Keep going past the screen's edge.
    const el = scroller();
    const box = el.getBoundingClientRect();
    if (e.clientY < box.top + 56) el.scrollTop -= 14;
    else if (e.clientY > Math.min(box.bottom, window.innerHeight) - 56) el.scrollTop += 14;
    let dy = e.clientY - s.y + (el.scrollTop - s.scroll);
    const idx = orderRef.current.indexOf(s.id);
    const rows = list.children;
    const next = rows[idx + 1] as HTMLElement | undefined;
    const prev = rows[idx - 1] as HTMLElement | undefined;
    // Past half of the neighbour: swap with it, and measure from the new place.
    if (next && dy > next.offsetHeight / 2) {
      move(idx, idx + 1);
      s.y += next.offsetHeight;
      dy -= next.offsetHeight;
    } else if (prev && dy < -prev.offsetHeight / 2) {
      move(idx, idx - 1);
      s.y -= prev.offsetHeight;
      dy += prev.offsetHeight;
    }
    setDrag({ id: s.id, dy });
  };
  const onUp = () => {
    start.current = null;
    setDrag(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      const moved = await reorderProducts(mergeOrder(all.map((p) => p.id), order));
      app.toast(moved ? 'Order saved. The register shows it too.' : 'Nothing moved', { tone: 'good' });
      onDone();
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t save the order', { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Callout tone="info">
        Drag <GripVertical size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> or use the arrows to put the products in the order you want them here and at the register.
        {category ? ` Only ${catName.get(category) ?? 'this category'} is being arranged; the others keep their places.` : ''}
      </Callout>
      <ol className="arrange-list" ref={listRef} aria-label="Product order">
        {order.map((id, i) => {
          const p = byId.get(id);
          if (!p) return null;
          const dragging = drag?.id === id;
          return (
            <li key={id} className={`arrange-row${dragging ? ' dragging' : ''}${p.active ? '' : ' muted'}`} style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}>
              <span
                className="arrange-handle"
                role="button"
                tabIndex={-1}
                aria-label={`Drag ${p.name}`}
                onPointerDown={(e) => onDown(e, id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <GripVertical size={20} aria-hidden="true" />
              </span>
              <span className="arrange-pos muted">{i + 1}</span>
              <span className="arrange-name">
                <b>{p.name}</b>
                <span className="muted tiny">{catName.get(p.categoryId ?? '') ?? 'No category'}</span>
              </span>
              <IconButton label={`Move ${p.name} up`} size="sm" plain disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp size={16} />
              </IconButton>
              <IconButton label={`Move ${p.name} down`} size="sm" plain disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown size={16} />
              </IconButton>
            </li>
          );
        })}
      </ol>
      <div className="actions sticky-actions">
        <Button onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy || !changed}>
          Save order
        </Button>
      </div>
    </div>
  );
}
