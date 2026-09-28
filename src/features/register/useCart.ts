import { useCallback, useEffect, useState } from 'react';
import { uid } from '../../lib/ids';
import type { CartDiscount, CartItem } from '../../domain/cart';
import type { Cents } from '../../lib/money';

export interface CartState {
  items: CartItem[];
  presetIds: string[];
  custom: CartDiscount[];
  note: string;
}

const empty = (): CartState => ({ items: [], presetIds: [], custom: [], note: '' });
const key = (eventId: string) => `jwpos-cart-${eventId}`;

function load(eventId: string | null): CartState {
  if (!eventId) return empty();
  try {
    const raw = localStorage.getItem(key(eventId));
    if (!raw) return empty();
    const v = JSON.parse(raw) as CartState;
    return { ...empty(), ...v, items: Array.isArray(v.items) ? v.items : [] };
  } catch {
    return empty();
  }
}

/** The cart survives a refresh or a closed tab (it is kept per event on this device). */
export function useCart(eventId: string | null) {
  const [state, setState] = useState<CartState>(() => load(eventId));

  useEffect(() => setState(load(eventId)), [eventId]);
  useEffect(() => {
    if (!eventId) return;
    try {
      if (state.items.length || state.custom.length || state.presetIds.length || state.note) localStorage.setItem(key(eventId), JSON.stringify(state));
      else localStorage.removeItem(key(eventId));
    } catch {
      /* storage full or blocked; the cart still works in memory */
    }
  }, [eventId, state]);

  const add = useCallback(
    (p: { id: string; name: string; categoryId: string | null; designerId: string | null }, price: Cents, qty = 1) =>
      setState((s) => {
        const existing = s.items.find((i) => i.productId === p.id && !i.free && i.unitPrice === price);
        if (existing) return { ...s, items: s.items.map((i) => (i === existing ? { ...i, qty: i.qty + qty } : i)) };
        return {
          ...s,
          items: [...s.items, { key: uid(), productId: p.id, name: p.name, categoryId: p.categoryId, unitPrice: price, qty, free: false, freeReason: '', designerId: p.designerId }],
        };
      }),
    [],
  );

  const setQty = useCallback(
    (k: string, qty: number) =>
      setState((s) => ({ ...s, items: qty <= 0 ? s.items.filter((i) => i.key !== k) : s.items.map((i) => (i.key === k ? { ...i, qty } : i)) })),
    [],
  );
  const remove = useCallback((k: string) => setState((s) => ({ ...s, items: s.items.filter((i) => i.key !== k) })), []);
  const setFree = useCallback(
    (k: string, free: boolean, reason = '') => setState((s) => ({ ...s, items: s.items.map((i) => (i.key === k ? { ...i, free, freeReason: free ? reason : '' } : i)) })),
    [],
  );
  const togglePreset = useCallback(
    (id: string) => setState((s) => ({ ...s, presetIds: s.presetIds.includes(id) ? s.presetIds.filter((x) => x !== id) : [...s.presetIds, id] })),
    [],
  );
  const addCustom = useCallback((d: CartDiscount) => setState((s) => ({ ...s, custom: [...s.custom, d] })), []);
  const removeCustom = useCallback((id: string) => setState((s) => ({ ...s, custom: s.custom.filter((d) => d.id !== id) })), []);
  const setNote = useCallback((note: string) => setState((s) => ({ ...s, note })), []);
  const clear = useCallback(() => setState(empty()), []);
  const replace = useCallback((next: CartState) => setState({ ...empty(), ...next }), []);

  return { state, add, setQty, remove, setFree, togglePreset, addCustom, removeCustom, setNote, clear, replace };
}

export type CartApi = ReturnType<typeof useCart>;
