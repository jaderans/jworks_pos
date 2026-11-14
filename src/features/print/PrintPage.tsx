import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, Camera, Check as CheckIcon, FileDown, PackageCheck, Pencil, Plus, Printer, Search, Settings2, Trash2, Truck, UserRound, Volume2, Wallet, X } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { alive, db } from '../../db/db';
import { setSetting, settingValue } from '../../db/settings';
import { useCustomers, useEvents, useMembers, usePaymentMethods, usePrintOrders, useSettingRows } from '../../hooks/data';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, EmptyState, IconButton, Loading, PageHeader, Segmented } from '../../components/ui';
import { Field, MoneyInput, NumberInput, Select, TextArea, TextInput } from '../../components/form';
import { peso, sum, type Cents } from '../../lib/money';
import { fmtDateTime, fmtIsoDate } from '../../lib/time';
import { safeFileName } from '../../lib/files';
import {
  DEFAULT_PRINT_RATES, PACK_SIZE_LABEL, PRINT_STATUS_LABEL, canMakeInto, customLine, illustrationLine, illustrationPrice, isOpenPrint, lineTotal, makeIntoLine, packLine, peelLine, printTotals, printWarnings, sheetsLine,
} from '../../domain/print';
import {
  approvePrint, blankDelivery, cancelPrint, createPrintOrder, deletePrintOrder, markProofSent, printDeleteBlock, setPrintStatus, takePrintPayment, updatePrintOrder, type NewPrintOrder,
} from '../../services/print';
import { CustomerPicker } from '../register/CustomerPicker';
import { FindOrderDialog } from '../orders/FindOrderDialog';
import { useCallOrder } from '../../display/voice';
import { makeIntoRates } from '../../domain/makeInto';
import { PhotoImg } from '../../booth/PhotoImg';
import { attachBoothPhoto } from '../../booth/photos';
import { CouponField, appliedFrom, useCouponCheck } from '../coupons/CouponField';
import { claimId } from '../../domain/coupons';
import type { BoothPhoto, BusinessSettings, Customer, IllustrationTier, PackSize, PrintLine, PrintOrder, PrintRates, PrintStatus } from '../../db/types';
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
  const [finding, setFinding] = useState(false);
  const callOrder = useCallOrder();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const photoId = params.get('photo');
  const fromPhoto = useLiveQuery(async () => (photoId ? ((await db.boothPhotos.get(photoId)) ?? null) : null), [photoId]);
  useEffect(() => {
    if (fromPhoto) setEditing('new');
  }, [fromPhoto?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const closeEditor = () => {
    setEditing(null);
    if (photoId) setParams({}, { replace: true });
  };

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
  const owner = app.can('viewProfit');
  const removeOrder = async (o: PrintOrder) => {
    const blocked = await printDeleteBlock(o);
    if (blocked) {
      app.toast(blocked, { tone: 'bad' });
      return;
    }
    const { paid } = printTotals(o, rates.downPct);
    const ok = await app.confirm({
      title: `Delete ${o.number}?`,
      message: `${paid ? `The ${peso(paid)} paid on it goes too, so refund the customer first if you need to. Cash already in a drawer stays counted there. ` : ''}It comes off this list and off Booth events in JoshWorks Studio. If it’s already a job there, Studio shows it under Deleted in the POS for you to delete. You can’t undo this.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await act(`${o.number} deleted`, () => deletePrintOrder(o.id));
  };
  const startPrinting = async (o: PrintOrder) => {
    const t = printTotals(o, rates.downPct);
    if (!t.downPaid && !(await app.confirm({ title: `Print ${o.number} without the down payment?`, message: `The rate sheet says we print once the ${rates.downPct}% down payment (${peso(t.down)}) is in.`, confirmLabel: 'Print anyway' }))) return;
    await act(`${o.number} is printing`, () => setPrintStatus(o.id, 'printing'));
  };

  return (
    <div className="page wide">
      <PageHeader
        title="Services"
        subtitle={`Sticker printing, illustration, pins, keychains and more: quote and proof, ${rates.downPct}% down, make it, then pickup or courier. Every payment is a sale in the Sales log, and JoshWorks Studio books each order as a job.`}
        actions={
          <>
            {app.can('calculator') ? (
              <Button onClick={() => setRatesOpen(true)}>
                <Settings2 size={18} /> Rate card
              </Button>
            ) : null}
            <Button onClick={() => navigate('/booth')}>
              <Camera size={18} /> Photo booth
            </Button>
            <Button onClick={() => setFinding(true)}>
              <Search size={18} /> Find an order
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={18} /> New service order
            </Button>
          </>
        }
      />

      {open.length === 0 && closed.length === 0 ? (
        <EmptyState icon={<Printer size={44} />} title="No service orders yet">
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
                    onReady={() =>
                      void act(`${o.number} is ready`, async () => {
                        await setPrintStatus(o.id, 'ready');
                        if (o.delivery.method === 'pickup') callOrder(o.number, nameOf(o));
                      })
                    }
                    onCall={() => callOrder(o.number, nameOf(o), true)}
                    onHandOver={() => setHanding(o)}
                    onDelete={owner ? () => void removeOrder(o) : undefined}
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
              <div key={o.id} className="list-item order-closed">
                <b className="mono">{o.number}</b>
                <span className="main-text">
                  <b>{nameOf(o)}</b>
                  <span>{o.lines.map((l) => l.label).join(', ')}</span>
                </span>
                <Badge tone={o.status === 'done' ? 'good' : undefined}>{o.status === 'done' ? (o.delivery.method === 'courier' ? 'Shipped' : 'Picked up') : 'Cancelled'}</Badge>
                <span className="muted tiny nowrap">{fmtDateTime(o.statusAt)}</span>
                <span className="row order-closed-actions">
                  <IconButton label={`PDF of ${o.number}`} size="sm" plain onClick={() => void pdf(o)}>
                    <FileDown size={15} />
                  </IconButton>
                  <IconButton label={`Edit ${o.number}`} size="sm" plain onClick={() => setEditing(o)}>
                    <Pencil size={15} />
                  </IconButton>
                  {owner ? (
                    <IconButton label={`Delete ${o.number}`} size="sm" plain onClick={() => void removeOrder(o)}>
                      <Trash2 size={15} />
                    </IconButton>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <PrintOrderDialog fromPhoto={editing === 'new' && fromPhoto ? { photo: fromPhoto, as: params.get('as') === 'illustration' ? 'illustration' : 'print' } : null} order={editing} rates={rates} onClose={closeEditor} />
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
      <FindOrderDialog open={finding} onClose={() => setFinding(false)} />
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
  /** Call the order out loud again. */
  onCall: () => void;
  /** Owner only. */
  onDelete?: () => void;
}) {
  const o = p.order;
  const t = printTotals(o, p.rates.downPct);
  const late = !!o.dueDate && o.status !== 'ready' && o.dueDate < new Date().toISOString().slice(0, 10);
  return (
    <article className="order-card" aria-label={`Service order ${o.number}`}>
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
          {p.onDelete ? (
            <IconButton label={`Delete ${o.number}`} size="sm" plain onClick={p.onDelete}>
              <Trash2 size={15} />
            </IconButton>
          ) : null}
        </div>
      </div>
      {o.boothPhotoId ? <BoothPhotoChip id={o.boothPhotoId} /> : null}
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
              <Printer size={15} /> Start making
            </Button>
          </>
        ) : o.status === 'printing' ? (
          <Button size="sm" variant="primary" onClick={p.onReady}>
            <PackageCheck size={15} /> Ready
          </Button>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={p.onHandOver}>
              {o.delivery.method === 'courier' ? <Truck size={15} /> : <PackageCheck size={15} />} {o.delivery.method === 'courier' ? 'Shipped' : 'Picked up'}
            </Button>
            {o.delivery.method === 'pickup' ? (
              <Button size="sm" variant="ghost" onClick={p.onCall}>
                <Volume2 size={15} /> Call
              </Button>
            ) : null}
          </>
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

function PrintOrderDialog({
  order,
  rates,
  onClose,
  fromPhoto,
}: {
  order: PrintOrder | 'new' | null;
  rates: PrintRates;
  onClose: () => void;
  /** A new order made from a photo booth picture: sticker printing, or an illustration drawn from it. */
  fromPhoto?: { photo: BoothPhoto; as: 'print' | 'illustration' } | null;
}) {
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
  const [illustratorId, setIllustratorId] = useState('');
  const [illustratorPct, setIllustratorPct] = useState<number | null>(rates.illustration.artistPct);
  const [files, setFiles] = useState('');
  const [notes, setNotes] = useState('');
  const [designNo, setDesignNo] = useState('');
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
  const [tier, setTier] = useState(rates.illustration.tiers[0]?.key ?? '');
  const [designs, setDesigns] = useState<number | null>(1);
  const [artPrice, setArtPrice] = useState<Cents | null>(null);

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
    setIllustratorId(o?.illustratorId ?? '');
    setIllustratorPct(o?.illustratorPct ?? rates.illustration.artistPct);
    setFiles(o?.files ?? '');
    setNotes(o?.notes ?? '');
    setDesignNo(o?.designNo ?? '');
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
    setDesigns(1);
    setArtPrice(null);
    if (order === 'new' && fromPhoto) {
      const p = fromPhoto.photo;
      setCustomerName(p.name);
      setContact(p.contact);
      setFiles(p.drive?.url ?? '');
      setNotes(fromPhoto.as === 'illustration' ? `Draw it from booth photo ${p.number}.` : `Print booth photo ${p.number}.`);
      if (fromPhoto.as === 'illustration') setKind('illustration');
    }
  }, [order, fromPhoto?.photo.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const couponCheck = useCouponCheck(couponCode, sum(lines.map(lineTotal)), order && order !== 'new' ? claimId('print', order.id) : null);

  if (!order) return null;
  const closed = order !== 'new' && !isOpenPrint(order);
  const draft = { lines, delivery, payments: order === 'new' ? [] : order.payments, printerPct: printerPct ?? 0, illustratorPct: illustratorPct ?? 0, coupon: closed ? order.coupon : appliedFrom(couponCheck) };
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
            : kind === 'illustration' && designs
              ? illustrationLine(rates, tier, designs, artPrice ?? undefined)
              : null;
  const makeInto = makeIntoRates(rates.makeInto);
  const addMakeInto = (i: number, kind: string) => {
    const rate = makeInto.find((m) => m.kind === kind);
    if (rate) setLines([...lines, makeIntoLine(rate, lines[i])]);
  };
  const artTier = rates.illustration.tiers.find((x) => x.key === tier);
  const artRate = artTier && designs ? illustrationPrice(artTier, designs) : null;
  const hasArt = lines.some((l) => l.kind === 'illustration') || !!illustratorId;

  const save = async () => {
    setError('');
    setBusy(true);
    const o: NewPrintOrder = { customerId: customer?.id ?? null, customerName: customer?.name ?? customerName, contact: customer ? customer.phone || customer.email || contact : contact, lines, delivery, printerId: printerId || null, illustratorId: illustratorId || null, files, notes, couponCode, designNo };
    try {
      if (isNew) {
        const created = await createPrintOrder({ ...o, boothPhotoId: fromPhoto?.photo.id }, app.device);
        app.toast(`Service order ${created.number} saved`, { tone: 'good' });
        // The photo stays with the order, and goes to Drive for the studio (or when there's internet).
        if (fromPhoto) void attachBoothPhoto(fromPhoto.photo.id, created).catch(() => undefined);
      } else {
        await updatePrintOrder(order.id, { ...o, printerPct: printerPct ?? rates.printerPct, illustratorPct: illustratorPct ?? rates.illustration.artistPct });
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
      title={isNew ? 'New service order' : `Edit ${order.number}`}
      size="wide"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {isNew ? 'Save service order' : 'Save'}
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
        <span className="label strong small">What to make</span>
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
                {!closed && canMakeInto(l) ? (
                  <Select aria-label={`Make ${l.label} into`} value="" onChange={(e) => addMakeInto(i, e.target.value)} style={{ width: 'auto' }}>
                    <option value="">Make it into…</option>
                    {makeInto.map((m) => (
                      <option key={m.kind} value={m.kind}>
                        {m.label}
                        {m.addOn ? ` (+${peso(m.addOn)} each)` : ''}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {!closed ? (
                  <IconButton label={`Remove ${l.label}`} size="sm" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                    <Trash2 size={15} />
                  </IconButton>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing yet. Add sticker sheets, peel-off sheets or packaging below.</p>
        )}
        {closed ? (
          <p className="muted small">A closed order keeps what was printed, its delivery and its price; the rest can still be fixed.</p>
        ) : (
          <>
            <div className="card soft stack tight">
              <Segmented
                label="Add"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'sheets', label: 'Sticker sheets' },
                  { value: 'peel', label: 'Peel-off sheets' },
                  { value: 'pack', label: 'Packaging' },
                  { value: 'illustration', label: 'Illustration' },
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
                ) : kind === 'illustration' ? (
                  <>
                    <Field label="Tier" htmlFor="po-tier" hint={artTier?.note} className="span-2">
                      <Select id="po-tier" value={tier} onChange={(e) => setTier(e.target.value)}>
                        {rates.illustration.tiers.map((x) => (
                          <option key={x.key} value={x.key}>
                            {x.name} · {peso(x.price)} a design
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Designs" htmlFor="po-designs" hint={artTier?.sets.length ? `Sets of ${artTier.sets.map((x) => x.designs).join(', ')} cost less.` : undefined}>
                      <NumberInput id="po-designs" decimals={false} min={1} value={designs} onChange={setDesigns} />
                    </Field>
                    <Field
                      label="Price"
                      htmlFor="po-art-price"
                      hint={artRate ? `Rate card: ${peso(artRate.total)}${artRate.saved ? `, a set saving ${peso(artRate.saved)}` : ''}. Type another price for this order.` : undefined}
                    >
                      <MoneyInput id="po-art-price" value={artPrice ?? artRate?.total ?? null} onChange={setArtPrice} />
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
                    if (kind === 'illustration') setArtPrice(null);
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
          </>
        )}
      </div>

      {!closed ? (
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
      ) : null}

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
          <Field label="Printer’s share" htmlFor="po-pct" hint={`Of the print work${t.discount ? ' after the coupon' : ''}, not the illustration or the delivery fee: ${peso(t.printerShare)}.`}>
            <NumberInput id="po-pct" min={0} value={printerPct} onChange={setPrinterPct} suffix="%" />
          </Field>
        ) : null}
        {hasArt ? (
          <Field label="Who draws it" htmlFor="po-artist" hint="Their share of the illustration goes to their earnings in JoshWorks Studio.">
            <Select id="po-artist" value={illustratorId} onChange={(e) => setIllustratorId(e.target.value)}>
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
        ) : null}
        {hasArt && app.can('viewProfit') ? (
          <Field label="Illustrator’s share" htmlFor="po-art-pct" hint={`Of the illustration${t.discount ? ' after its part of the coupon' : ''}: ${peso(t.illustratorShare)}.`}>
            <NumberInput id="po-art-pct" min={0} value={illustratorPct} onChange={setIllustratorPct} suffix="%" />
          </Field>
        ) : null}
        <Field label="Design no." htmlFor="po-design" hint="For custom stickers: the number on the design file in Drive, e.g. CS01.">
          <TextInput id="po-design" value={designNo} onChange={(e) => setDesignNo(e.target.value.toUpperCase())} placeholder="CS01" maxLength={12} />
        </Field>
        {fromPhoto && order === 'new' ? (
          <div className="po-photo span-2">
            <PhotoImg photo={fromPhoto.photo} className="po-photo-img" />
            <p className="muted small">
              From booth photo <b>{fromPhoto.photo.number}</b>. It stays with this order, and goes to Google Drive → JoshWorks POS → Booth photos when you save, with its link in Files.
            </p>
          </div>
        ) : null}
        <Field label="Files" htmlFor="po-files" hint="Drive or Messenger link to the designs.">
          <TextInput id="po-files" value={files} onChange={(e) => setFiles(e.target.value)} placeholder="https://drive.google.com/…" />
        </Field>
        <Field label="Notes" htmlFor="po-notes">
          <TextArea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      {!closed ? (
        <CouponField id="po-coupon" code={couponCode} onCode={setCouponCode} check={couponCheck} hint="From a JoshWorks event. It comes off the print work (₱2,500 or more), not the delivery fee." />
      ) : null}

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
        {!closed ? (
          <div className="wf-row">
            <span>
              {rates.downPct}% down payment to start{t.a4 ? ` · ${t.a4} A4 sheet${t.a4 === 1 ? '' : 's'} to print` : ''}
            </span>
            <span className="v">{peso(t.down)}</span>
          </div>
        ) : null}
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
  const events = useEvents();
  const [countAt, setCountAt] = useState('');
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
    setCountAt(app.activeEventId ?? '');
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!order || !t) return null;
  const method = active.find((m) => m.id === methodId);
  // Events a payment can count at: the ones still running or coming, newest first.
  const open = (events ?? []).filter((e) => e.status === 'live' || e.status === 'planning' || e.id === countAt);

  const save = async () => {
    setError('');
    if (!method) return setError('Pick how they paid.');
    if (method.requireRef && !ref.trim()) return setError(`Enter the ${method.name} reference number.`);
    setBusy(true);
    try {
      await takePrintPayment(
        order.id,
        { methodId: method.id, name: method.name, kind: method.kind, amount: amount ?? 0, ref, by: app.member?.id ?? null },
        session ? { session, device: app.device } : null,
        !session && countAt ? { eventId: countAt, device: app.device } : null,
      );
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
      <Field label="Reference no." htmlFor="pp-ref">
        <TextInput id="pp-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method?.kind === 'cash' ? 'Not needed for cash' : 'From the GCash or bank receipt'} />
      </Field>
      {!session ? (
        <Field label="Count it at" htmlFor="pp-event">
          <Select id="pp-event" value={countAt} onChange={(e) => setCountAt(e.target.value)}>
            {open.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value="">No event: keep it on the order only</option>
          </Select>
        </Field>
      ) : null}
      <Callout tone="info">
        {session
          ? `It goes in register ${session.letter} as a sale under Services, so it counts in the Sales log, the money totals${method?.kind === 'cash' ? ' and the drawer' : ''}.`
          : countAt
            ? `No register is open on this phone, so it’s a sale under Services at ${open.find((e) => e.id === countAt)?.name ?? 'that event'}: in the Sales log and the revenue, not in a drawer.`
            : 'It stays on the order only, not in any event’s sales.'}
      </Callout>
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
  const setTier = (i: number, ch: Partial<IllustrationTier>) => setR({ ...r, illustration: { ...r.illustration, tiers: r.illustration.tiers.map((x, k) => (k === i ? { ...x, ...ch } : x)) } });
  const setTierSet = (i: number, j: number, price: Cents) => setTier(i, { sets: r.illustration.tiers[i].sets.map((x, k) => (k === j ? { ...x, price } : x)) });
  const setSizes = [...new Set(r.illustration.tiers.flatMap((x) => x.sets.map((y) => y.designs)))].sort((a, b) => a - b);
  const makeInto = makeIntoRates(r.makeInto);
  const setAddOn = (kind: string, addOn: Cents) => setR({ ...r, makeInto: makeInto.map((m) => (m.kind === kind ? { ...m, addOn } : m)) });
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
            <Field label="Illustrator’s share" htmlFor="rc-artist" hint="Of the illustration; the default for new orders.">
              <NumberInput id="rc-artist" min={0} value={r.illustration.artistPct} onChange={(n) => setR({ ...r, illustration: { ...r.illustration, artistPct: Math.min(100, Math.max(0, n ?? 0)) } })} suffix="%" />
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
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Sticker illustration</th>
              <th className="r">1 design</th>
              {setSizes.map((n) => (
                <th key={n} className="r">
                  Set of {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.illustration.tiers.map((x, i) => (
              <tr key={x.key}>
                <td>
                  <b>{x.name}</b>
                  <div className="muted tiny">{x.note}</div>
                </td>
                <td className="r" style={{ width: 120 }}>
                  <MoneyInput ariaLabel={`${x.name}, one design`} value={x.price} onChange={(c) => setTier(i, { price: c ?? 0 })} />
                </td>
                {setSizes.map((n) => {
                  const j = x.sets.findIndex((y) => y.designs === n);
                  return (
                    <td key={n} className="r" style={{ width: 120 }}>
                      {j >= 0 ? (
                        <>
                          <MoneyInput ariaLabel={`${x.name}, set of ${n}`} value={x.sets[j].price} onChange={(c) => setTierSet(i, j, c ?? 0)} />
                          <div className={`tiny ${x.sets[j].price < n * x.price ? 'muted' : 'bad'}`}>
                            {x.sets[j].price < n * x.price ? `save ${peso(n * x.price - x.sets[j].price)}` : 'no saving'}
                          </div>
                        </>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Make it into</th>
              <th>Price</th>
              <th className="r">Add-on per piece</th>
            </tr>
          </thead>
          <tbody>
            {makeInto.map((m) => (
              <tr key={m.kind}>
                <td>
                  <b>{m.label}</b>
                </td>
                <td className="muted small">{m.withDesign ? 'The design’s price, plus the add-on' : 'Its own price'}</td>
                <td className="r" style={{ width: 140 }}>
                  <MoneyInput ariaLabel={`${m.label} add-on`} value={m.addOn} onChange={(c) => setAddOn(m.kind, c ?? 0)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** The booth photo an order was made from, when it's on this laptop. */
function BoothPhotoChip({ id }: { id: string }) {
  const navigate = useNavigate();
  const photo = useLiveQuery(() => db.boothPhotos.get(id), [id]);
  if (!photo) return null;
  return (
    <button type="button" className="po-photo-chip" onClick={() => navigate('/booth')} title="Open the photo booth">
      <PhotoImg photo={photo} className="po-photo-thumb" />
      <span className="small">Booth photo {photo.number}</span>
    </button>
  );
}
