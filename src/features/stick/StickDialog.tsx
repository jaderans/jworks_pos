import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, CloudCheck, Printer } from 'lucide-react';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { settingValue } from '../../db/settings';
import { useCategories, useOrders, usePrintOrders, useProducts, useSettingRows } from '../../hooks/data';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Callout, Segmented } from '../../components/ui';
import { Check, Field, Select, TextInput } from '../../components/form';
import { peso } from '../../lib/money';
import { fmtTime } from '../../lib/time';
import { isOpenOrder } from '../../domain/orders';
import {
  DEFAULT_STICK, ENJOY, PACK_CODES, PACK_NAME, estimateReady, isAddOnCategory, minisFor, nextDesignNos, packFileName, packOf, packPeople, readyText,
  type Making, type PackCode, type StickOrder, type StickPack, type StickPerson, type StickSettings,
} from '../../domain/stick';
import { saveStickOrder } from '../../services/stick';
import { stickSender } from '../../display/channel';
import { PhotoImg } from '../../booth/PhotoImg';
import { orderPhotoName } from '../../domain/stick';
import { MiniPicker } from './MiniPicker';
import { printStubs } from './Stubs';
import type { JWEvent, Order, Sale } from '../../db/types';
import type { DisplayStick } from '../../domain/display';
import './stick.css';

/** What the customer screen shows while the cashier fills it in, so the customer can check it. */
export type StickDraft = DisplayStick;

/** Hints for where each person stands in the photo, by how many there are. */
const WHERE: Record<number, string[]> = {
  1: ['white shirt, glasses'],
  2: ['left', 'right'],
  3: ['left', 'middle', 'right'],
  4: ['far left', 'left', 'right', 'far right'],
  5: ['far left', 'left', 'middle', 'right', 'far right'],
};

/**
 * Couple-of-Stickers details, after the customer pays: their nickname, each
 * pack (printing or illustrating, the mini stickers, a note), the design file
 * it goes in, and when it should be ready. Saving makes the order on Orders
 * with one number for everything they bought, and prints the two stubs.
 */
export function StickDialog({
  sale,
  ev,
  existing,
  onClose,
  onSaved,
  onDraft,
}: {
  sale: Sale;
  ev: Pick<JWEvent, 'id' | 'name'>;
  existing?: Order | null;
  onClose: () => void;
  onSaved?: (o: Order) => void;
  onDraft?: (d: StickDraft | null) => void;
}) {
  const app = useApp();
  const navigate = useNavigate();
  const products = useProducts();
  const categories = useCategories();
  const orders = useOrders();
  const prints = usePrintOrders();
  const rows = useSettingRows();
  const settings: StickSettings = { ...DEFAULT_STICK, ...settingValue<Partial<StickSettings>>(rows, 'stick') };
  const art = useLiveQuery(() => db.stickerArt.toArray(), []);
  const [nickname, setNickname] = useState(existing?.stick?.nickname ?? '');
  const [email, setEmail] = useState(existing?.stick?.email ?? '');
  const [softCopy, setSoftCopy] = useState(existing?.stick?.softCopy ?? false);
  const [photo, setPhoto] = useState<StickOrder['photo']>(existing?.stick?.photo ?? 'message');
  const [packs, setPacks] = useState<StickPack[] | null>(existing?.stick?.packs ?? null);
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The packs on the sale, one per pack bought, each with the next free design number.
  useEffect(() => {
    if (packs || !products || !orders || !prints || !art) return;
    const byId = new Map(products.map((p) => [p.id, p]));
    const found: Omit<StickPack, 'designNo'>[] = [];
    for (const l of sale.lines) {
      const p = byId.get(l.productId);
      const k = p ? packOf(p, settings) : null;
      if (k) for (let i = 0; i < l.qty; i++) found.push({ name: l.name, pack: k.pack, singles: k.singles, making: 'printing', minis: [], note: '', addOns: [] });
    }
    // Add-ons bought with them (a keychain, a pin, an extra reprint) go with the first pack until moved.
    if (found.length) for (const a of addOnLines) found[0].addOns = [...(found[0].addOns ?? []), a];
    const used = [...orders.flatMap((o) => [o.designNo ?? '', ...(o.stick?.packs.map((x) => x.designNo) ?? [])]), ...prints.map((o) => o.designNo ?? ''), ...art.map((a) => a.code)];
    const nos = nextDesignNos(found.length, used, settings.designPrefix);
    setPacks(found.map((p, i) => ({ ...p, designNo: nos[i] })));
  }, [products, orders, prints, art, categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const packIds = useMemo(() => new Set((products ?? []).filter((p) => packOf(p, settings)).map((p) => p.id)), [products, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const addOnCats = new Set((categories ?? []).filter((c) => isAddOnCategory(c.name)).map((c) => c.id));
  const isAddOn = (l: Sale['lines'][number]) => !!l.categoryId && addOnCats.has(l.categoryId);
  /** One entry per add-on bought: "Keychain", "Keychain", "Pin". */
  const addOnLines = sale.lines.filter(isAddOn).flatMap((l) => Array.from({ length: l.qty }, () => l.name));
  // Anything else they bought with it, not part of a pack.
  const addOns = sale.lines.filter((l) => !packIds.has(l.productId) && !isAddOn(l)).map((l) => `${l.qty} × ${l.name}`);
  const ahead = (orders ?? []).filter((o) => o.stick && o.id !== existing?.id && o.eventId === ev.id && isOpenOrder(o) && o.status !== 'ready');
  // When they paid: the estimate holds still while the details are filled in.
  const [now] = useState(() => Date.now());
  const est = existing?.stick ? { from: existing.stick.readyFrom, to: existing.stick.readyTo, ahead: ahead.length } : estimateReady(packs ?? [], ahead.map((o) => ({ packs: o.stick!.packs, started: o.status === 'in-progress' })), settings, now);
  const paidWith = sale.prizeFor ? 'Wheel prize (free)' : sale.payments.map((p) => (p.ref ? `${p.name} (ref ${p.ref})` : p.name)).join(' + ') || 'Free';

  // Keep the customer screen showing what's being filled in.
  // Their photo from our booth, when this laptop has it.
  const boothPhoto = useLiveQuery(async () => (existing?.stick?.photoId ? ((await db.boothPhotos.get(existing.stick.photoId)) ?? null) : null), [existing?.stick?.photoId]);
  // Each pack's own photo, when its people aren't in the order's photo.
  const packPhotoIds = (existing?.stick?.packs ?? []).map((p) => p.photoId ?? '');
  const packPhotos = useLiveQuery(async () => Promise.all(packPhotoIds.map(async (id) => (id ? ((await db.boothPhotos.get(id)) ?? null) : null))), [packPhotoIds.join()]) ?? [];
  // Outside the register (Orders), the dialog shows the order on the customer screen itself.
  const screen = useMemo(() => (onDraft ? null : stickSender()), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => screen?.close(), [screen]);
  const draftKey = JSON.stringify([nickname, packs, addOns, est.from, est.to, photo, boothPhoto?.id ?? '', packPhotos.map((x) => x?.id ?? '')]);
  useEffect(() => {
    if (!packs) return;
    const d = { number: existing?.number ?? null, nickname, packs, addOns, readyFrom: est.from, readyTo: est.to, photo, paid: sale.total, paidWith };
    if (onDraft) onDraft(d);
    else screen?.send({ ...d, photoPic: boothPhoto?.blob ?? null, packPics: packPhotos.map((x) => x?.blob ?? null) });
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDraft?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const setPack = (i: number, ch: Partial<StickPack>) => setPacks((ps) => (ps ?? []).map((p, k) => (k === i ? { ...p, ...ch } : p)));
  const setPerson = (i: number, k: number, ch: Partial<StickPerson>) =>
    setPacks((ps) => (ps ?? []).map((p, n) => (n === i ? { ...p, people: packPeople(p).map((x, j) => (j === k ? { ...x, ...ch } : x)) } : p)));

  /** `pack`: the photo is for that pack only (its people aren't in the others' photo). */
  const save = async (then: 'close' | 'print' | 'photo', pack?: number) => {
    if (!packs) return;
    setBusy(true);
    setError('');
    try {
      const stick: StickOrder = {
        ...existing?.stick,
        nickname, email, softCopy: softCopy && !!email.trim(), packs, addOns, saleId: sale.id, receiptNo: sale.receiptNo, paid: sale.total, paidWith, readyFrom: est.from, readyTo: est.to, photo,
      };
      const order = await saveStickOrder({ sale, stick, existing, eventId: ev.id, device: app.device });
      app.toast(existing ? `${order.number} saved` : `Couple-of-Stickers ${order.number} for ${order.customerName}: it’s on Orders`, { tone: 'good' });
      if (then === 'print') printStubs({ number: order.number, eventName: ev.name, at: order.createdAt, stick: order.stick! }, settings.stubPaper);
      onSaved?.(order);
      onClose();
      // Their photo, now: the photo booth opens for this order, on this screen and the customer screen.
      if (then === 'photo') navigate(`/booth?order=${order.id}${pack !== undefined ? `&pack=${pack}` : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save it');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      fullPhone
      title={existing ? `Couple-of-Stickers ${existing.number}` : `Couple-of-Stickers for ${sale.receiptNo}`}
      initialFocus="#st-nick"
      footer={
        <>
          <Button onClick={onClose}>{existing ? 'Close' : 'Later'}</Button>
          <Button onClick={() => void save('close')} disabled={busy || !packs?.length}>
            Save
          </Button>
          {photo === 'booth' && !existing?.stick?.photoId ? (
            <Button variant="teal" onClick={() => void save('photo')} disabled={busy || !packs?.length}>
              <Camera size={16} /> {(packs?.length ?? 0) > 1 ? 'Save and take one photo of everyone' : 'Save and take their photo'}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void save('print')} disabled={busy || !packs?.length}>
            <Printer size={16} /> Save and print stubs
          </Button>
        </>
      }
    >
      {boothPhoto ? (
        <div className="stick-art">
          <PhotoImg photo={boothPhoto} />
          <span className="small">
            <b>Their photo:</b> {orderPhotoName(existing!.number, nickname || existing!.stick!.nickname)}. It prints on the information stub for the illustrator.
          </span>
        </div>
      ) : null}
      {packs && !packs.length ? <Callout tone="warn">No Couple-of-Stickers packs on this sale. Settings → Couple-of-Stickers says which products are packs.</Callout> : null}
      <Callout tone="good" title={`Paid ${peso(sale.total)} by ${paidWith}`}>
        {sale.receiptNo}
        {existing ? ` · stub ${existing.number}` : ' · the stub number comes when you save'}
      </Callout>
      <div className="form-grid">
        <Field label="Name or nickname" htmlFor="st-nick" hint="Who it’s for: on the claim stub and the customer screen. Each pack says who’s drawn on it.">
          <TextInput id="st-nick" value={nickname} onChange={(e) => setNickname(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" htmlFor="st-email" hint="Optional: for a soft copy of their stickers.">
          <TextInput id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
        </Field>
      </div>
      <Check id="st-soft" checked={softCopy} onChange={setSoftCopy} label="They want a soft copy" sub={email.trim() ? `Sent to ${email.trim()} when it’s done.` : 'Add their email above.'} disabled={!email.trim()} />
      <Field label="Their photo" htmlFor="st-photo">
        <Segmented<StickOrder['photo']>
          label="Their photo"
          value={photo}
          onChange={setPhoto}
          options={[
            { value: 'message', label: 'They’ll message it' },
            { value: 'booth', label: 'Our photo booth' },
            { value: 'none', label: 'Not needed' },
          ]}
          full
        />
      </Field>

      <div className="stick-packs">
        {(packs ?? []).map((p, i) => {
          const file = packFileName(p, nickname);
          const people = packPeople(p);
          const own = packPhotos[i];
          const inDrive = (art ?? []).find((a) => a.code.toUpperCase() === p.designNo.toUpperCase());
          const max = minisFor(p);
          return (
            <section key={i} className="stick-pack card" aria-label={`Pack ${i + 1}: ${p.name}`}>
              <div className="row between wrap">
                <b>
                  {i + 1}. {p.name}
                </b>
                <div className="row" style={{ gap: 6 }}>
                  <Select aria-label={`Pack ${i + 1} is`} value={p.pack} onChange={(e) => setPack(i, { pack: e.target.value as PackCode, minis: p.minis.slice(0, minisFor({ pack: e.target.value as PackCode, singles: p.singles })) })} style={{ width: 'auto' }}>
                    {PACK_CODES.map((c) => (
                      <option key={c} value={c}>
                        {c} · {PACK_NAME[c]}
                      </option>
                    ))}
                  </Select>
                  {p.singles ? <Badge tone="teal">Singles</Badge> : null}
                </div>
              </div>
              <Segmented<Making>
                label={`How pack ${i + 1} is made`}
                value={p.making}
                onChange={(making) => setPack(i, { making })}
                options={[
                  { value: 'printing', label: 'Printing' },
                  { value: 'illustrating', label: 'Illustrating' },
                ]}
              />
              <div className="stick-people" role="group" aria-label={`Who’s on pack ${i + 1}`}>
                <span className="small">
                  <b>Who’s on it:</b> {people.length > 1 ? 'the names drawn on the stickers, and where each one is in the photo.' : 'the name drawn on the sticker, and how to find them in the photo.'}
                  {nickname.trim() ? ` Empty: ${nickname.trim()}.` : ''}
                </span>
                {people.map((x, k) => (
                  <div key={k} className="stick-person">
                    <span className="stick-person-no" aria-hidden="true">
                      {k + 1}
                    </span>
                    <TextInput aria-label={`Pack ${i + 1}, person ${k + 1}: name`} value={x.name} onChange={(e) => setPerson(i, k, { name: e.target.value })} placeholder={people.length > 1 ? `Name ${k + 1}` : 'Name on the sticker'} />
                    <TextInput aria-label={`Pack ${i + 1}, person ${k + 1}: in the photo`} value={x.who} onChange={(e) => setPerson(i, k, { who: e.target.value })} placeholder={`In the photo: ${WHERE[people.length]?.[k] ?? 'what they wear'}`} />
                  </div>
                ))}
              </div>
              {own ? (
                <div className="stick-art">
                  <PhotoImg photo={own} />
                  <span className="small">
                    <b>Pack {i + 1}’s photo:</b> {file}. It prints on the information stub.
                  </span>
                </div>
              ) : photo === 'booth' && (packs ?? []).length > 1 ? (
                <Button size="sm" variant="teal" onClick={() => void save('photo', i)} disabled={busy}>
                  <Camera size={15} /> Save and take pack {i + 1}’s photo
                </Button>
              ) : null}
              <div className="form-grid">
                <Field label="Design no." htmlFor={`st-no-${i}`} hint={`Save the finished design in Drive → JoshWorks POS → Custom stickers as ${file}.png.`}>
                  <TextInput id={`st-no-${i}`} value={p.designNo} onChange={(e) => setPack(i, { designNo: e.target.value.toUpperCase().replace(/\s+/g, '') })} />
                </Field>
                <Field label="Note" htmlFor={`st-note-${i}`}>
                  <TextInput id={`st-note-${i}`} value={p.note} onChange={(e) => setPack(i, { note: e.target.value })} placeholder="e.g. matching outfits, a cat between them" />
                </Field>
              </div>
              {p.addOns?.length ? (
                <div className="stick-addons" aria-label={`Add-ons for pack ${i + 1}`}>
                  {p.addOns.map((a, k) => (
                    <span key={k} className="stick-addon">
                      + {a}
                      {(packs ?? []).length > 1 ? (
                        <Select
                          aria-label={`Move ${a} to`}
                          value={String(i)}
                          onChange={(e) => {
                            const to = Number(e.target.value);
                            setPacks((ps) => (ps ?? []).map((x, n) => (n === i ? { ...x, addOns: (x.addOns ?? []).filter((_, j) => j !== k) } : n === to ? { ...x, addOns: [...(x.addOns ?? []), a] } : x)));
                          }}
                          style={{ width: 'auto' }}
                        >
                          {(packs ?? []).map((_, n) => (
                            <option key={n} value={n}>
                              Pack {n + 1}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
              {inDrive ? <DriveArt blob={inDrive.blob} name={inDrive.name} /> : null}
              {max ? (
                <>
                  <Button size="sm" onClick={() => setPicking(picking === i ? null : i)} aria-expanded={picking === i}>
                    {picking === i ? 'Done picking' : p.minis.length ? `Mini stickers: ${p.minis.join(', ')}` : `Pick ${max} mini stickers`}
                  </Button>
                  {picking === i ? <MiniPicker label={`Mini stickers for pack ${i + 1}`} value={p.minis} max={max} onChange={(minis) => setPack(i, { minis })} /> : null}
                </>
              ) : (
                <p className="muted small">Singles: the illustrated stickers only, no mini stickers.</p>
              )}
            </section>
          );
        })}
      </div>

      <div className="stick-summary">
        {addOns.length ? (
          <p className="small">
            <b>Also bought:</b> {addOns.join(', ')}
          </p>
        ) : null}
        <Callout tone="info" title={`Ready in ${readyText({ readyFrom: est.from, readyTo: est.to }, now)}, around ${fmtTime(est.from)}`}>
          {est.ahead ? `${est.ahead} order${est.ahead === 1 ? '' : 's'} ahead of this one. ` : ''}
          {ENJOY}
        </Callout>
      </div>
      {error ? (
        <p className="small bad" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted small">Both stubs print together: they keep the claim stub, the information stub goes to whoever makes it. The customer screen shows them all this to check.</p>
    </Dialog>
  );
}

/** A finished design already in Drive, shown small. */
function DriveArt({ blob, name }: { blob: Blob; name: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="stick-art">
      <img src={url} alt={name} />
      <span className="small">
        <CloudCheck size={14} aria-hidden="true" /> {name} is in Drive
      </span>
    </div>
  );
}
