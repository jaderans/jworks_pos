import { flushSync } from 'react-dom';
import { Printer } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/ui';
import { createRoot } from 'react-dom/client';
import { fmtTime } from '../../lib/time';
import { peso } from '../../lib/money';
import { ENJOY, PACK_CODES, claimNo, designFileName, minisFor, orderPhotoName, packLabel, readyText, type StickOrder, type StickSettings } from '../../domain/stick';
import mark from '../../assets/brand/mark.png';
import './stubs.css';

export interface StubOrder {
  number: string;
  eventName: string;
  at: number;
  stick: StickOrder;
}

/**
 * The two stubs for one Couple-of-Stickers order, like the printed ones: the
 * claim stub the customer keeps (their number, when it should be ready), and
 * the information stub for whoever makes it (name, time, packs, mini
 * stickers, design files, add-ons, note). One pair per customer, however
 * many packs they bought.
 */
export function Stubs({ o, paper, now = Date.now() }: { o: StubOrder; paper: StickSettings['stubPaper']; now?: number }) {
  const s = o.stick;
  const no = claimNo(o.number);
  const packs = new Set(s.packs.map((p) => p.pack));
  const singles = s.packs.some((p) => p.singles);
  const making = new Set(s.packs.map((p) => p.making));
  return (
    <div className={`stubs paper-${paper}`} aria-label={`Stubs for ${o.number}`}>
      <section className="stub claim" aria-label="Claim stub">
        <header>
          <img src={mark} alt="" className="stub-mark" />
          <div>
            <b className="stub-title">Stick Together</b>
            <span className="stub-sub">Couple-of-Stickers</span>
          </div>
          <span className="stub-badge">Claim stub</span>
        </header>
        <b className="stub-no">{no}</b>
        <p className="stub-wait">Wait for your number to be called.</p>
        <p className="stub-ready">
          Ready in {readyText(s, now)}
          <br />
          around {fmtTime(s.readyFrom)}
        </p>
        <p className="stub-enjoy">{ENJOY}</p>
        <footer>
          {o.number} · {o.eventName}
        </footer>
      </section>
      <div className="stub-cut" aria-hidden="true" />
      <section className="stub info" aria-label="Information stub">
        <div className="stub-row">
          <span className="stub-label">Name</span>
          <b className="stub-fill">{s.nickname || '—'}</b>
          <b className="stub-no-small">{no}</b>
        </div>
        <div className="stub-row">
          <span className="stub-label">Time</span>
          <span className="stub-fill">
            {fmtTime(o.at)} · ready {fmtTime(s.readyFrom)}–{fmtTime(s.readyTo)}
          </span>
        </div>
        <div className="stub-row">
          <span className="stub-label">Pack</span>
          <span className="stub-circles">
            {PACK_CODES.map((c) => (
              <span key={c} className={`stub-circle${packs.has(c) ? ' on' : ''}`}>
                {c}
              </span>
            ))}
          </span>
        </div>
        <div className="stub-row stub-checks">
          <span className={`stub-check${singles ? ' on' : ''}`}>Singles</span>
          <span className={`stub-check${making.has('printing') ? ' on' : ''}`}>Printing</span>
          <span className={`stub-check${making.has('illustrating') ? ' on' : ''}`}>Illustrating</span>
        </div>
        <ol className="stub-packs">
          {s.packs.map((p, i) => (
            <li key={i}>
              <b>
                {packLabel(p)} · {p.making === 'illustrating' ? 'Illustrating' : 'Printing'}
              </b>
              <span>{designFileName(p.designNo, s.nickname)}.png</span>
              {minisFor(p) ? <span>Minis: {p.minis.length ? p.minis.join(', ') : 'to pick'}</span> : null}
              {p.addOns?.length ? <span className="stub-addons">{p.addOns.map((a) => `+ ${a}`).join('  ')}</span> : null}
              {p.note ? <span>Note: {p.note}</span> : null}
            </li>
          ))}
        </ol>
        {s.addOns.length ? <p className="stub-line">Also: {s.addOns.join(', ')}</p> : null}
        <p className="stub-line">
          Paid: {peso(s.paid)} · {s.paidWith}
          {s.receiptNo ? ` · ${s.receiptNo}` : ''}
        </p>
        {s.softCopy && s.email ? <p className="stub-line">Soft copy: {s.email}</p> : null}
        <p className="stub-line">
          Photo: {s.photo === 'booth' ? `our photo booth${s.photoId ? ` (${orderPhotoName(o.number, s.nickname)})` : ''}` : s.photo === 'message' ? 'they’ll message it to JoshWorks' : 'none needed'}
        </p>
      </section>
    </div>
  );
}

const PAGE: Record<StickSettings['stubPaper'], string> = {
  sheet: '@page { size: A4 portrait; margin: 10mm; }',
  r80: '@page { size: 80mm 230mm; margin: 2mm; }',
  r58: '@page { size: 58mm 230mm; margin: 1.5mm; }',
};

/** Print the stubs: the browser's print dialog, with only the stubs on the page. */
export function printStubs(o: StubOrder, paper: StickSettings['stubPaper']): void {
  const host = document.createElement('div');
  host.className = 'stub-print';
  document.body.appendChild(host);
  const page = document.createElement('style');
  page.textContent = PAGE[paper];
  document.head.appendChild(page);
  const root = createRoot(host);
  flushSync(() => root.render(<Stubs o={o} paper={paper} />));
  const done = () => {
    window.removeEventListener('afterprint', done);
    root.unmount();
    host.remove();
    page.remove();
  };
  window.addEventListener('afterprint', done);
  // Let the logo load before the dialog opens.
  const img = host.querySelector('img');
  const go = () => {
    window.print();
    // Browsers that don't fire afterprint (or tests that replace print) still clean up.
    window.setTimeout(done, 1500);
  };
  if (img && !img.complete) img.addEventListener('load', go, { once: true });
  else go();
}

/** See the stubs before printing them (or instead of printing). */
export function StubsDialog({ o, paper, onClose }: { o: StubOrder | null; paper: StickSettings['stubPaper']; onClose: () => void }) {
  if (!o) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      size="wide"
      title={`Stubs for ${o.number}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={() => printStubs(o, paper)}>
            <Printer size={16} /> Print
          </Button>
        </>
      }
    >
      <div className="stubs-preview">
        <Stubs o={o} paper={paper} />
      </div>
      <p className="muted small">The claim stub is theirs to keep; the information stub goes to whoever makes it. Paper: Settings → Couple-of-Stickers.</p>
    </Dialog>
  );
}
