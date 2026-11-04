import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Check as CheckIcon, FileDown, PackageCheck, Pencil, Plus, Printer, Settings2, Trash2, Truck, UserRound, Wallet, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { alive, db } from '../../db/db';
import { setSetting, settingValue } from '../../db/settings';
import { useCustomers, useMembers, usePaymentMethods, usePrintOrders, useSettingRows } from '../../hooks/data';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, sum, type Cents } from '../../lib/money';
import { fmtDateTime, fmtIsoDate } from '../../lib/time';
import { safeFileName } from '../../lib/files';
import {
  DEFAULT_PRINT_RATES, PACK_SIZE_LABEL, PRINT_STATUS_LABEL, customLine, isOpenPrint, lineTotal, packLine, peelLine, printTotals, printWarnings, sheetsLine,
} from '../../domain/print';
import {
  approvePrint, blankDelivery, cancelPrint, createPrintOrder, markProofSent, setPrintStatus, takePrintPayment, updatePrintOrder, type NewPrintOrder,
} from '../../services/print';
import { CustomerPicker } from '../register/CustomerPicker';
import { CouponField, appliedFrom, useCouponCheck } from '../coupons/CouponField';
import { claimId } from '../../domain/coupons';
import type { BusinessSettings, Customer, PackSize, PrintLine, PrintOrder, PrintRates, PrintStatus } from '../../db/types';
import '../orders/orders.css';

const COLUMNS: { status: PrintStatus; hint: string }[] = [
  { status: 'quote', hint: 'Files, proof, and the down payment' },
  { status: 'printing', hint: 'Approved and paid down' },
  { status: 'ready', hint: 'Waiting for pickup or the courier' },
];

/** Selling → Printing: sticker printing jobs from quote to pickup or courier. */
export default function PrintPage() {
  const app = useApp();
  const orders = usePrintOrders();
  const members = useMembers();
  const customers = useCustomers();
  const settingRows = useSettingRows();
  const rates = settingValue<PrintRates>(settingRows, 'printRates');
  const business = settingValue<BusinessSettings>(settingRows, 'business');
  const [editing, setEditing] = useState<PrintOrder | 'new' | null>(null);
  const [paying, setPaying] = useState<PrintOrder | null>(null);
  const [handing, setHanding] = useState<PrintOrder | null>(null);
  const [cancelling, setCancelling] = useState<PrintOrder | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);

  const memberName = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  const custName = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c.name])), [customers]);
  if (!orders || !members) return <Loading />;
  const nameOf = (o: PrintOrder) => (o.customerId ? custName.get(o.customerId) : null) ?? o.customerName ?? 'Customer';
  const open = orders.filter(isOpenPrint);
  const closed = orders.filter((o) => !isOpenPrint(o)).slice(0, 40);

  const pdf = async (o: PrintOrder) => {
    const { buildPrintPdf } = await import('../../reports/printPdf');
    const { deliverPdf } = await import('../../reports/pdf');
    const { quotePayMethods } = await import('../../reports/quotePdf');
    await deliverPdf(await buildPrintPdf({ ...o, customerName: nameOf(o) }, { business: business.name, rates, payMethods: await quotePayMethods() }), `${o.number} - ${safeFileName(nameOf(o))} - sticker printing.pdf`);
  };
  const act = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
      app.toast(label, { tone: 'good' });
    } catch (e) {
      app.toast(e instanceof Error ? e.message : 'Couldn’t do that', { tone: 'bad' });
    }
  };
  const startPrinting = async (o: PrintOrder) => {
    const t = printTotals(o, rates.downPct);
    if (!t.downPaid && !(await app.confirm({ title: `Print ${o.number} without the down payment?`, message: `The rate sheet says we print once the ${rates.downPct}% down payment (${peso(t.down)}) is in.`, confirmLabel: 'Print anyway' }))) return;
    await act(`${o.number} is printing`, () => setPrintStatus(o.id, 'printing'));
  };

  return (
    <div className="page wide">
      <PageHeader
        title="Sticker printing"
        subtitle={`Print jobs for customers: quote and proof, ${rates.downPct}% down, print, then pickup or courier. JoshWorks Studio books each one as a Sticker Printing job.`}
        actions={
          <>
            {app.can('calculator') ? (
              <Button onClick={() => setRatesOpen(true)}>
                <Settings2 size={18} /> Rate card
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={18} /> New print order
            </Button>
          </>
        }
      />

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState icon={<Printer size={44} />} title="No print orders yet">
          When someone messages for stickers, labels or peel-off packs, price it here from the rate card and send them the quote.
        </EmptyState>
      ) : (
        <div className="order-board">
          {COLUMNS.map((col) => {
            const list = open.filter((o) => o.status === col.status);
            return (
              <section key={col.status} className="order-col" aria-label={PRINT_STATUS_LABEL[col.status]}>
                <div className="order-col-head">
                  <b>{PRINT_STATUS_LABEL[col.status]}</b>
                  <Badge>{list.length}</Badge>
                </div>
                <p className="muted tiny">{col.hint}</p>
                {list.map((o) => (
                  <PrintCard
                    key={o.id}
                    order={o}
                    rates={rates}
                    customer={nameOf(o)}
                    printer={o.printerId ? memberName.get(o.printerId) : undefined}
                    onEdit={() => setEditing(o)}
                    onPdf={() => void pdf(o)}
                    onCancel={() => setCancelling(o)}
                    onPay={() => setPaying(o)}
                    onProof={() => void act('Proof marked as sent', () => markProofSent(o.id))}
                    onApprove={() => void act('Approved', async () => app.toast(`Ready by ${fmtIsoDate(await approvePrint(o.id))}`))}
                    onPrint={() => void startPrinting(o)}
                    onReady={() => void act(`${o.number} is ready`, () => setPrintStatus(o.id, 'ready'))}
                    onHandOver={() => setHanding(o)}
                  />
                ))}
              </section>
            );
          })}
        </div>
      )}

      {closed.length ? (
        <details className="card">
          <summary className="strong">Done and cancelled ({closed.length})</summary>
          <div className="list" style={{ marginTop: 8 }}>
            {closed.map((o) => (
              <div key={o.id} className="list-item">
                <b className="mono">{o.number}</b>
                <span className="main-text">
                  <b>{nameOf(o)}</b>
                  <span>{o.lines.map((l) => l.label).join(', ')}</span>
                </span>
                <Badge tone={o.status === 'done' ? 'good' : undefined}>{o.status === 'done' ? (o.delivery.method === 'courier' ? 'Shipped' : 'Picked up') : 'Cancelled'}</Badge>
                <span className="muted tiny nowrap">{fmtDateTime(o.statusAt)}</span>
                <IconButton label={`PDF of ${o.number}`} size="sm" plain onClick={() => void pdf(o)}>
                  <FileDown size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <PrintOrderDialog order={editing} rates={rates} onClose={() => setEditing(null)} />
      <PayDialog order={paying} rates={rates} onClose={() => setPaying(null)} />
      <HandOverDialog
        order={handing}
        rates={rates}
        onClose={() => setHanding(null)}
        onPay={() => {
          setPaying(handing);
          setHanding(null);
        }}
      />
      <CancelDialog order={cancelling} onClose={() => setCancelling(null)} />
      {ratesOpen ? <RateCardDialog rates={rates} onClose={() => setRatesOpen(false)} /> : null}
    </div>
  );
}

function PrintCard(p: {
  order: PrintOrder;
  rates: PrintRates;
  customer: string;
  printer?: string;
  onEdit: () => void;
  onPdf: () => void;
  onCancel: () => void;
  onPay: () => void;
  onProof: () => void;
  onApprove: () => void;
  onPrint: () => void;
  onReady: () => void;
  onHandOver: () => void;
}) {
  const o = p.order;
  const t = printTotals(o, p.rates.downPct);
  const late = !!o.dueDate && o.status !== 'ready' && o.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <article className="order-card" aria-label={`Print order ${o.number}`}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="order-no">{o.number}</div>
          <div className="strong">{p.customer}</div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <IconButton label={`PDF of ${o.number}`} size="sm" plain onClick={p.onPdf}>
            <FileDown size={15} />
          </IconButton>
          <IconButton label={`Edit ${o.number}`} size="sm" plain onClick={p.onEdit}>
            <Pencil size={15} />
          </IconButton>
          <IconButton label={`Cancel ${o.number}`} size="sm" plain onClick={p.onCancel}>
            <Ban size={15} />
          </IconButton>
        </div>
      </div>
      <ul className="order-lines">
        {o.lines.map((l, i) => (
          <li key={i}>
            {l.qty} × {l.label}
          </li>
        ))}
      </ul>
      <div className="row wrap" style={{ gap: 6 }}>
        {o.status === 'quote' ? <Badge tone={o.approvedAt ? 'good' : o.proofAt ? 'teal' : undefined}>{o.approvedAt ? 'Approved' : o.proofAt ? 'Proof sent' : 'Quote'}</Badge> : null}
        {o.dueDate ? <Badge tone={late ? 'warn' : undefined}>Ready by {fmtIsoDate(o.dueDate)}</Badge> : null}
        {o.delivery.method === 'courier' ? <Badge>Courier{o.delivery.courier ? `: ${o.delivery.courier}` : ''}</Badge> : null}
        {p.printer ? <Badge tone="teal">{p.printer}</Badge> : null}
        {o.coupon ? <Badge tone="yellow">Coupon {o.coupon.code}</Badge> : null}
      </div>
      <div className="row between small">
        <span className="muted">
          {peso(t.total)}
          {t.paid ? ` · ${peso(t.paid)} paid` : ' · no payment yet'}
        </span>
        <b className={t.balance ? '' : 'good'}>{t.balance ? `${peso(t.balance)} due` : 'Paid'}</b>
      </div>
      {o.status === 'quote' && !t.downPaid ? <p className="muted tiny">Down payment to start: {peso(t.down)}</p> : null}
      <div className="actions">
        {o.status === 'quote' ? (
          <>
            {!o.proofAt && !o.approvedAt ? (
              <Button size="sm" onClick={p.onProof}>
                Proof sent
              </Button>
            ) : null}
            {!o.approvedAt ? (
              <Button size="sm" onClick={p.onApprove}>
                <CheckIcon size={15} /> Approved
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={p.onPrint}>
              <Printer size={15} /> Start printing
            </Button>
          </>
        ) : o.status === 'printing' ? (
          <Button size="sm" variant="primary" onClick={p.onReady}>
            <PackageCheck size={15} /> Ready
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={p.onHandOver}>
            {o.delivery.method === 'courier' ? <Truck size={15} /> : <PackageCheck size={15} />} {o.delivery.method === 'courier' ? 'Shipped' : 'Picked up'}
          </Button>
        )}
        {t.balance > 0 ? (
          <Button size="sm" variant="ghost" onClick={p.onPay}>
            <Wallet size={15} /> Payment
          </Button>
        ) : null}
      </div>
    </article>
  );
}

type LineKind = PrintLine['kind'];

function PrintOrderDialog({ order, rates, onClose }: { order: PrintOrder | 'new' | null; rates: PrintRates; onClose: () => void }) {
  const app = useApp();
  const members = useMembers();
  const customers = useCustomers();
  const isNew = order === 'new';
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [contact, setContact] = useState('');
  const [lines, setLines] = useState<PrintLine[]>([]);
  const [delivery, setDelivery] = useState(blankDelivery());
  const [printerId, setPrinterId] = useState('');
  const [printerPct, setPrinterPct] = useState<number | null>(rates.printerPct);
  const [files, setFiles] = useState('');
  const [notes, setNotes] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The line being built
  const [kind, setKind] = useState<LineKind>('sheets');
  const [material, setMaterial] = useState(rates.materials[1]?.key ?? rates.materials[0]?.key ?? '');
  const [cut, setCut] = useState('kiss');
  const [size, setSize] = useState('');
  const [sheets, setSheets] = useState<number | null>(rates.minSheets);
  const [peelSize, setPeelSize] = useState(rates.peelSizes[0]?.key ?? '');
  const [peelCount, setPeelCount] = useState<number | null>(20);
  const [pack, setPack] = useState(rates.packs[0]?.key ?? '');
  const [packSize, setPackSize] = useState<PackSize>('small');
  const [packs, setPacks] = useState<number | null>(rates.minPacks);
  const [customLabel, setCustomLabel] = useState('');
  const [customQty, setCustomQty] = useState<number | null>(1);
  const [customPrice, setCustomPrice] = useState<Cents | null>(null);

  useEffect(() => {
    if (!order) return;
    const o = order === 'new' ? null : order;
    setCustomer(o?.customerId ? (customers ?? []).find((c) => c.id === o.customerId) ?? null : null);
    setCustomerName(o?.customerName ?? '');
    setContact(o?.contact ?? '');
    setLines(o?.lines ?? []);
    setDelivery(o?.delivery ?? blankDelivery());
    setPrinterId(o?.printerId ?? '');
    setPrinterPct(o?.printerPct ?? rates.printerPct);
    setFiles(o?.files ?? '');
    setNotes(o?.notes ?? '');
    setCouponCode(o?.coupon?.code ?? '');
    setError('');
    // Each time it opens, the line builder starts over on sticker sheets.
    setKind('sheets');
    setCut('kiss');
    setSize('');
    setSheets(rates.minSheets);
    setPeelCount(20);
    setPacks(rates.minPacks);
    setCustomLabel('');
    setCustomQty(1);
    setCustomPrice(null);
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  const couponCheck = useCouponCheck(couponCode, sum(lines.map(lineTotal)), order && order !== 'new' ? claimId('print', order.id) : null);

  if (!order) return null;
  const draft = { lines, delivery, payments: order === 'new' ? [] : order.payments, printerPct: printerPct ?? 0, coupon: appliedFrom(couponCheck) };
  const t = printTotals(draft, rates.downPct);
  const warnings = printWarnings({ lines }, rates);
  const preview: PrintLine | null =
    kind === 'sheets' && sheets
      ? sheetsLine(rates, material, cut, sheets, size || undefined)
      : kind === 'peel' && peelCount
        ? peelLine(rates, material, peelSize, peelCount)
        : kind === 'pack' && packs
          ? packLine(rates, pack, packSize, packs)
          : kind === 'custom' && customLabel.trim() && customQty && customPrice !== null
            ? customLine(customLabel.trim(), customQty, customPrice)
            : null;

  const save = async () => {
    setError('');
    setBusy(true);
    const o: NewPrintOrder = { customerId: customer?.id ?? null, customerName: customer?.name ?? customerName, contact: customer ? customer.phone || customer.email || contact : contact, lines, delivery, printerId: printerId || null, files, notes, couponCode };
    try {
      if (isNew) {
        const created = await createPrintOrder(o, app.device);
        app.toast(`Print order ${created.number} saved`, { tone: 'good' });
      } else {
        await updatePrintOrder(order.id, { ...o, printerPct: printerPct ?? rates.printerPct });
        app.toast('Saved', { tone: 'good' });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save it');
    } finally {
      setBusy(false);
    }
  };

  const groups = ['Standard', 'Premium', 'Paper'] as const;
  const materialSelect = (
    <Select id="po-material" value={material} onChange={(e) => setMaterial(e.target.value)}>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {rates.materials
            .filter((m) => m.group === g)
            .map((m) => (
              <option key={m.key} value={m.key}>
                {m.name} · {peso(m.price)}/sheet
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'New print order' : `Edit ${order.number}`}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {isNew ? 'Save print order' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="stack tight">
        <span className="label strong small">Customer</span>
        {customer ? (
          <div className="row">
            <UserRound size={18} />
            <b className="grow">{customer.name}</b>
            <IconButton label="Choose a different customer" size="sm" onClick={() => setCustomer(null)}>
              <X size={16} />
            </IconButton>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Name" htmlFor="po-name">
              <TextInput id="po-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Who it’s for" />
            </Field>
            <Field label="Mobile, email or @handle" htmlFor="po-contact">
              <TextInput id="po-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
            </Field>
            <div className="span-2">
              <Button size="sm" onClick={() => setPicking(true)}>
                <UserRound size={15} /> Pick a saved customer
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="stack tight">
        <span className="label strong small">What to print</span>
        {lines.length ? (
          <div className="list">
            {lines.map((l, i) => (
              <div key={i} className="list-item">
                <span className="main-text">
                  <b>{l.label}</b>
                  <span>
                    {l.qty} × {peso(l.unitPrice, { decimals: 2 })}
                    {l.a4 ? ` · ${l.a4} A4 sheet${l.a4 === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                <b>{peso(lineTotal(l))}</b>
                <IconButton label={`Remove ${l.label}`} size="sm" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing yet. Add sticker sheets, peel-off sheets or packaging below.</p>
        )}
        <div className="card soft stack tight">
          <Segmented
            label="Add"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'sheets', label: 'Sticker sheets' },
              { value: 'peel', label: 'Peel-off sheets' },
              { value: 'pack', label: 'Packaging' },
              { value: 'custom', label: 'Other' },
            ]}
          />
          <div className="form-grid">
            {kind === 'sheets' ? (
              <>
                <Field label="Material" htmlFor="po-material">
                  {materialSelect}
                </Field>
                <Field label="Cut" htmlFor="po-cut">
                  <Select id="po-cut" value={cut} onChange={(e) => setCut(e.target.value)}>
                    {rates.cuts
                      .filter((c) => c.key !== 'peel')
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.name}
                          {c.price ? ` +${peso(c.price)}/sheet` : ' (included)'}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Sticker size (optional)" htmlFor="po-size" hint="Shows about how many fit.">
                  <Select id="po-size" value={size} onChange={(e) => setSize(e.target.value)}>
                    <option value="">Mixed designs</option>
                    {rates.stickerSizes.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} · {s.perA4} per sheet
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="A4 sheets" htmlFor="po-sheets">
                  <NumberInput id="po-sheets" decimals={false} min={1} value={sheets} onChange={setSheets} />
                </Field>
              </>
            ) : kind === 'peel' ? (
              <>
                <Field label="Material" htmlFor="po-material">
                  {materialSelect}
                </Field>
                <Field label="Peel-off sheet size" htmlFor="po-peel">
                  <Select id="po-peel" value={peelSize} onChange={(e) => setPeelSize(e.target.value)}>
                    {rates.peelSizes.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name} · {s.perA4} per A4
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Peel-off sheets" htmlFor="po-peel-count">
                  <NumberInput id="po-peel-count" decimals={false} min={1} value={peelCount} onChange={setPeelCount} />
                </Field>
              </>
            ) : kind === 'pack' ? (
              <>
                <Field label="Packaging" htmlFor="po-pack" className="span-2">
                  <Select id="po-pack" value={pack} onChange={(e) => setPack(e.target.value)}>
                    {rates.packs.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Size" htmlFor="po-pack-size">
                  <Select id="po-pack-size" value={packSize} onChange={(e) => setPackSize(e.target.value as PackSize)}>
                    {(['small', 'medium', 'large'] as const).map((s) => (
                      <option key={s} value={s}>
                        {PACK_SIZE_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Packs" htmlFor="po-packs" hint={`At least ${rates.minPacks} per design.`}>
                  <NumberInput id="po-packs" decimals={false} min={1} value={packs} onChange={setPacks} />
                </Field>
              </>
            ) : (
              <>
                <Field label="What it is" htmlFor="po-custom" className="span-2">
                  <TextInput id="po-custom" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Label layout and design, rush fee" />
                </Field>
                <Field label="How many" htmlFor="po-custom-qty">
                  <NumberInput id="po-custom-qty" decimals={false} min={1} value={customQty} onChange={setCustomQty} />
                </Field>
                <Field label="Price each" htmlFor="po-custom-price">
                  <MoneyInput id="po-custom-price" value={customPrice} onChange={setCustomPrice} />
                </Field>
              </>
            )}
          </div>
          <div className="row between wrap">
            <span className="muted small">{preview ? `${preview.label}: ${preview.qty} × ${peso(preview.unitPrice, { decimals: 2 })} = ${peso(lineTotal(preview))}` : 'Fill in the line to add it.'}</span>
            <Button
              size="sm"
              disabled={!preview}
              onClick={() => {
                if (!preview) return;
                setLines([...lines, preview]);
                if (kind === 'custom') {
                  setCustomLabel('');
                  setCustomPrice(null);
                }
              }}
            >
              <Plus size={15} /> Add to the order
            </Button>
          </div>
        </div>
        {warnings.length ? (
          <Callout tone="warn">
            {warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Callout>
        ) : null}
      </div>

      <div className="stack tight">
        <span className="label strong small">Delivery</span>
        <Segmented
          label="Delivery"
          value={delivery.method}
          onChange={(method) => setDelivery({ ...delivery, method })}
          options={[
            { value: 'pickup', label: 'Pick up in Iloilo City' },
            { value: 'courier', label: 'Courier' },
          ]}
        />
        {delivery.method === 'courier' ? (
          <div className="form-grid">
            <Field label="Courier" htmlFor="po-courier">
              <TextInput id="po-courier" value={delivery.courier} onChange={(e) => setDelivery({ ...delivery, courier: e.target.value })} placeholder="J&T, LBC, Lalamove…" />
            </Field>
            <Field label="Delivery fee" htmlFor="po-fee" hint="Added to the order; the studio pays the courier.">
              <MoneyInput id="po-fee" value={delivery.fee} onChange={(c) => setDelivery({ ...delivery, fee: c ?? 0 })} />
            </Field>
            <Field label="Address" htmlFor="po-address" className="span-2">
              <TextArea id="po-address" rows={2} value={delivery.address} onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="form-grid">
        <Field label="Who prints it" htmlFor="po-printer" hint="Their share goes to their earnings in JoshWorks Studio.">
          <Select id="po-printer" value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            <option value="">Not set yet</option>
            {(members ?? [])
              .filter((m) => m.active === 1)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </Field>
        {app.can('viewProfit') ? (
          <Field label="Printer’s share" htmlFor="po-pct" hint={`Of the print work${t.discount ? ' after the coupon' : ''}, not the delivery fee: ${peso(t.printerShare)}.`}>
            <NumberInput id="po-pct" min={0} value={printerPct} onChange={setPrinterPct} suffix="%" />
          </Field>
        ) : null}
        <Field label="Files" htmlFor="po-files" hint="Drive or Messenger link to the designs.">
          <TextInput id="po-files" value={files} onChange={(e) => setFiles(e.target.value)} placeholder="https://drive.google.com/…" />
        </Field>
        <Field label="Notes" htmlFor="po-notes">
          <TextArea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <CouponField id="po-coupon" code={couponCode} onCode={setCouponCode} check={couponCheck} hint="From a JoshWorks event. It comes off the print work (₱2,500 or more), not the delivery fee." />

      <div className="waterfall card">
        <div className="wf-row">
          <span>Printing and packaging</span>
          <span className="v">{peso(t.subtotal)}</span>
        </div>
        {t.discount ? (
          <div className="wf-row">
            <span>Coupon {couponCode}</span>
            <span className="v">−{peso(t.discount)}</span>
          </div>
        ) : null}
        {t.delivery ? (
          <div className="wf-row">
            <span>Delivery</span>
            <span className="v">{peso(t.delivery)}</span>
          </div>
        ) : null}
        <div className="wf-row total">
          <span>Total</span>
          <span className="v">{peso(t.total)}</span>
        </div>
        <div className="wf-row">
          <span>
            {rates.downPct}% down payment to start{t.a4 ? ` · ${t.a4} A4 sheet${t.a4 === 1 ? '' : 's'} to print` : ''}
          </span>
          <span className="v">{peso(t.down)}</span>
        </div>
      </div>
      {error ? <Callout tone="bad">{error}</Callout> : null}
      <CustomerPicker
        open={picking}
        onClose={() => setPicking(false)}
        eventId={null}
        onPick={(c) => {
          setCustomer(c);
          setPicking(false);
        }}
      />
    </Dialog>
  );
}

function PayDialog({ order, rates, onClose }: { order: PrintOrder | null; rates: PrintRates; onClose: () => void }) {
  const app = useApp();
  const methods = usePaymentMethods();
  const session = useLiveQuery(async () => alive(await db.sessions.toArray()).find((s) => s.deviceId === app.device.deviceId && s.closedAt === null) ?? null, [app.device.deviceId]);
  const [amount, setAmount] = useState<Cents | null>(null);
  const [methodId, setMethodId] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = (methods ?? []).filter((m) => m.active === 1);
  const t = order ? printTotals(order, rates.downPct) : null;
  useEffect(() => {
    if (!order || !t) return;
    setAmount(t.downPaid ? t.balance : Math.min(t.balance, t.down - t.paid));
    setMethodId(active.find((m) => m.kind !== 'cash')?.id ?? active[0]?.id ?? '');
    setRef('');
    setError('');
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!order || !t) return null;
  const method = active.find((m) => m.id === methodId);

  const save = async () => {
    setError('');
    if (!method) return setError('Pick how they paid.');
    if (method.requireRef && !ref.trim()) return setError(`Enter the ${method.name} reference number.`);
    setBusy(true);
    try {
      await takePrintPayment(order.id, { methodId: method.id, name: method.name, kind: method.kind, amount: amount ?? 0, ref, by: app.member?.id ?? null }, session ?? null);
      app.toast(`${peso(amount ?? 0)} received for ${order.number}`, { tone: 'good' });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Payment for ${order.number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || !amount}>
            Save payment
          </Button>
        </>
      }
    >
      <p className="small">
        Total {peso(t.total)} · paid {peso(t.paid)} · <b>{peso(t.balance)} due</b>
        {!t.downPaid ? ` · down payment ${peso(t.down)}` : ''}
      </p>
      <Field label="Amount" htmlFor="pp-amount">
        <MoneyInput id="pp-amount" value={amount} onChange={setAmount} large />
      </Field>
      <Field label="Paid by" htmlFor="pp-method">
        <Select id="pp-method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
          {active.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reference no." htmlFor="pp-ref" hint={method?.kind === 'cash' ? (session ? `Goes in register ${session.letter}’s drawer as cash in.` : 'Kept apart from the register drawer.') : undefined}>
        <TextInput id="pp-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method?.kind === 'cash' ? 'Not needed for cash' : 'From the GCash or bank receipt'} />
      </Field>
      {error ? <Callout tone="bad">{error}</Callout> : null}
    </Dialog>
  );
}

function HandOverDialog({ order, rates, onClose, onPay }: { order: PrintOrder | null; rates: PrintRates; onClose: () => void; onPay: () => void }) {
  const app = useApp();
  const [tracking, setTracking] = useState('');
  useEffect(() => setTracking(order?.delivery.tracking ?? ''), [order]);
  if (!order) return null;
  const t = printTotals(order, rates.downPct);
  const courier = order.delivery.method === 'courier';
  const done = async () => {
    await setPrintStatus(order.id, 'done', courier ? tracking : undefined);
    app.toast(`${order.number} ${courier ? 'shipped' : 'picked up'}`, { tone: 'good' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={courier ? `Ship ${order.number}` : `Hand over ${order.number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {t.balance > 0 ? (
            <Button variant="primary" onClick={onPay}>
              <Wallet size={16} /> Take the {peso(t.balance)} first
            </Button>
          ) : null}
          <Button variant={t.balance > 0 ? 'ghost' : 'primary'} onClick={done}>
            {courier ? 'Shipped' : 'Picked up'}
          </Button>
        </>
      }
    >
      {t.balance > 0 ? <Callout tone="warn">{peso(t.balance)} is still due on this order.</Callout> : <p>Paid in full.</p>}
      {courier ? (
        <Field label="Tracking number" htmlFor="ho-tracking" hint={`${order.delivery.courier || 'Courier'} to ${order.delivery.address}`}>
          <TextInput id="ho-tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </Field>
      ) : null}
    </Dialog>
  );
}

function CancelDialog({ order, onClose }: { order: PrintOrder | null; onClose: () => void }) {
  const app = useApp();
  const [reason, setReason] = useState('');
  useEffect(() => setReason(''), [order]);
  if (!order) return null;
  const paid = order.payments.reduce((a, p) => a + p.amount, 0);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Cancel ${order.number}?`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Keep it</Button>
          <Button
            variant="danger"
            onClick={async () => {
              await cancelPrint(order.id, reason);
              app.toast(`${order.number} cancelled`, { tone: 'good' });
              onClose();
            }}
          >
            Cancel the order
          </Button>
        </>
      }
    >
      {paid ? <Callout tone="warn">{peso(paid)} was paid. If you refund it, send it back by the same method; the payments stay on the order for the records.</Callout> : null}
      <Field label="Why (optional)" htmlFor="pc-reason">
        <TextInput id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/** The owner's rate card: prices per sheet, cuts, packaging, peel-off sizes and the rules. */
function RateCardDialog({ rates, onClose }: { rates: PrintRates; onClose: () => void }) {
  const app = useApp();
  const [r, setR] = useState<PrintRates>(rates);
  const setMat = (i: number, ch: Partial<PrintRates['materials'][number]>) => setR({ ...r, materials: r.materials.map((m, k) => (k === i ? { ...m, ...ch } : m)) });
  const setCut = (i: number, price: Cents) => setR({ ...r, cuts: r.cuts.map((c, k) => (k === i ? { ...c, price } : c)) });
  const setPack = (i: number, size: PackSize, v: Cents) => setR({ ...r, packs: r.packs.map((p, k) => (k === i ? { ...p, [size]: v } : p)) });
  const save = async () => {
    await setSetting('printRates', r);
    app.toast('Rate card saved. Every phone uses it from now on.', { tone: 'good' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Sticker printing rate card"
      size="xwide"
      footer={
        <>
          <Button variant="ghost" onClick={() => setR(DEFAULT_PRINT_RATES)}>
            Back to the 2026 rate sheet
          </Button>
          <span className="grow" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save rate card
          </Button>
        </>
      }
    >
      <p className="muted small">Prices are per A4 sheet with kiss cut. “Cost” is what one sheet costs the studio (paper, laminate, ink); it goes to Studio as the job’s materials expense. Leave it blank if you don’t know it yet.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th className="r">Price / sheet</th>
              <th className="r">Cost / sheet</th>
            </tr>
          </thead>
          <tbody>
            {r.materials.map((m, i) => (
              <tr key={m.key}>
                <td>
                  <b>{m.group}</b> {m.name}
                </td>
                <td className="r" style={{ width: 140 }}>
                  <MoneyInput ariaLabel={`Price of ${m.group} ${m.name}`} value={m.price} onChange={(c) => setMat(i, { price: c ?? 0 })} />
                </td>
                <td className="r" style={{ width: 140 }}>
                  <MoneyInput ariaLabel={`Cost of ${m.group} ${m.name}`} value={m.cost} onChange={(c) => setMat(i, { cost: c })} placeholder="—" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <div className="stack tight">
          <span className="label strong small">Cutting add-ons (per sheet)</span>
          {r.cuts.map((c, i) => (
            <Field key={c.key} label={c.name} htmlFor={`rc-cut-${c.key}`}>
              <MoneyInput id={`rc-cut-${c.key}`} value={c.price} onChange={(v) => setCut(i, v ?? 0)} />
            </Field>
          ))}
        </div>
        <div className="stack tight">
          <span className="label strong small">Rules</span>
          <div className="form-grid">
            <Field label="Minimum A4 sheets" htmlFor="rc-min">
              <NumberInput id="rc-min" decimals={false} min={1} value={r.minSheets} onChange={(n) => setR({ ...r, minSheets: Math.max(1, n ?? 1) })} />
            </Field>
            <Field label="Minimum packs per design" htmlFor="rc-packs">
              <NumberInput id="rc-packs" decimals={false} min={1} value={r.minPacks} onChange={(n) => setR({ ...r, minPacks: Math.max(1, n ?? 1) })} />
            </Field>
            <Field label="Lead time from" htmlFor="rc-lead-min">
              <NumberInput id="rc-lead-min" decimals={false} min={0} value={r.leadDays.min} onChange={(n) => setR({ ...r, leadDays: { ...r.leadDays, min: n ?? 0 } })} suffix="days" />
            </Field>
            <Field label="to" htmlFor="rc-lead-max">
              <NumberInput id="rc-lead-max" decimals={false} min={0} value={r.leadDays.max} onChange={(n) => setR({ ...r, leadDays: { ...r.leadDays, max: n ?? 0 } })} suffix="days" />
            </Field>
            <Field label="Down payment" htmlFor="rc-down">
              <NumberInput id="rc-down" min={0} value={r.downPct} onChange={(n) => setR({ ...r, downPct: Math.min(100, Math.max(0, n ?? 0)) })} suffix="%" />
            </Field>
            <Field label="Printer’s share" htmlFor="rc-printer" hint="The default for new orders.">
              <NumberInput id="rc-printer" min={0} value={r.printerPct} onChange={(n) => setR({ ...r, printerPct: Math.min(100, Math.max(0, n ?? 0)) })} suffix="%" />
            </Field>
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Packaging (per pack)</th>
              <th className="r">Small</th>
              <th className="r">Medium</th>
              <th className="r">Large</th>
            </tr>
          </thead>
          <tbody>
            {r.packs.map((p, i) => (
              <tr key={p.key}>
                <td>{p.name}</td>
                {(['small', 'medium', 'large'] as const).map((s) => (
                  <td key={s} className="r" style={{ width: 120 }}>
                    <MoneyInput ariaLabel={`${p.name}, ${s}`} value={p[s]} onChange={(c) => setPack(i, s, c ?? 0)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
