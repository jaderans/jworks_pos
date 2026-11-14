import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../app/AppContext';
import { useCustomers, useOrderSales, useOrders, usePrintOrders, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { Dialog } from '../../components/Dialog';
import { Badge, Button } from '../../components/ui';
import { SearchInput } from '../../components/form';
import { peso } from '../../lib/money';
import { fmtIsoDate } from '../../lib/time';
import { ORDER_STATUS_LABEL, dueText, orderMoney } from '../../domain/orders';
import { PRINT_STATUS_LABEL, printTotals } from '../../domain/print';
import { findOrders } from '../../domain/findOrder';
import type { PrintRates } from '../../db/types';

/**
 * Find an order at the counter: the customer says "CS01" or "QA-07", or gives
 * their name or number, and the cashier sees who ordered what, where it is,
 * and what's still due.
 */
export function FindOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const navigate = useNavigate();
  const orders = useOrders();
  const prints = usePrintOrders();
  const customers = useCustomers();
  const orderSales = useOrderSales();
  const rates = settingValue<PrintRates>(useSettingRows(), 'printRates');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const canOrders = app.can('orders');
  const canPrints = app.can('printOrders');
  const found = useMemo(
    () => findOrders(q, canOrders ? (orders ?? []) : [], canPrints ? (prints ?? []) : [], customers ?? []),
    [q, orders, prints, customers, canOrders, canPrints],
  );
  const nameOf = (customerId: string | null, typed: string) => (customerId ? customers?.find((c) => c.id === customerId)?.name : undefined) ?? typed ?? 'Customer';

  return (
    <Dialog open={open} onClose={onClose} title="Find an order" initialFocus="input[type=search]" footer={<Button onClick={onClose}>Close</Button>}>
      <SearchInput value={q} onChange={setQ} placeholder="CS01, QA-07, PA-002, a name or a phone number" ariaLabel="Order number, design no., name or phone" />
      {q.trim().length >= 2 && !found.length ? <p className="muted small">No order matches “{q.trim()}”.</p> : null}
      {found.length ? (
        <div className="card flush">
          <div className="list" aria-label="Orders found">
            {found.map((f) => {
              const o = f.order;
              const money = f.kind === 'order' ? orderMoney(f.order, orderSales ?? []) : null;
              const t = f.kind === 'print' ? printTotals(f.order, rates.downPct) : null;
              const due = money ? money.balance : (t?.balance ?? 0);
              const total = money ? money.total : (t?.total ?? 0);
              const status = f.kind === 'order' ? ORDER_STATUS_LABEL[f.order.status] : PRINT_STATUS_LABEL[f.order.status];
              const ready = f.kind === 'order' ? dueText(f.order.dueAt) : f.order.dueDate ? fmtIsoDate(f.order.dueDate) : '';
              const items = f.kind === 'order' ? f.order.lines.map((l) => `${l.qty} × ${l.name}`) : f.order.lines.map((l) => `${l.qty} × ${l.label}`);
              return (
                <div key={o.id} className="list-item found-order">
                  <div className="found-no">
                    <b className="mono">{o.number}</b>
                    {o.designNo ? <Badge tone="yellow">{o.designNo}</Badge> : null}
                  </div>
                  <span className="main-text">
                    <b>{nameOf(o.customerId, o.customerName)}</b>
                    <span>{items.join(', ')}</span>
                    <span>
                      {o.contact ? `${o.contact} · ` : ''}
                      {status}
                      {ready ? ` · ready by ${ready}` : ''}
                    </span>
                  </span>
                  <span className="found-money">
                    <b className={due ? '' : 'good'}>{due ? `${peso(due)} due` : 'Paid'}</b>
                    <span className="muted tiny">of {peso(total)}</span>
                    <Button
                      size="sm"
                      onClick={() => {
                        onClose();
                        navigate(f.kind === 'order' ? '/orders' : '/print');
                      }}
                    >
                      Open {f.kind === 'order' ? 'Orders' : 'Services'}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
