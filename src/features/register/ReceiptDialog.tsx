import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/ui';
import { peso } from '../../lib/money';
import { fmtDateTime } from '../../lib/time';
import type { BusinessSettings, Sale } from '../../db/types';

export function receiptText(sale: Sale, business: BusinessSettings, eventName: string): string {
  const lines = [
    business.name,
    eventName,
    `${sale.receiptNo} · ${fmtDateTime(sale.at)}`,
    '',
    ...sale.lines.map((l) => `${l.qty} × ${l.name}  ${l.free ? 'FREE' : peso(l.gross)}`),
    ...sale.discounts.map((d) => `${d.label}  -${peso(d.amount)}`),
    `TOTAL ${peso(sale.total)}`,
    ...sale.payments.map((p) => `${p.name} ${peso(p.amount)}${p.ref ? ` ref ${p.ref}` : ''}`),
    ...(sale.change ? [`Change ${peso(sale.change)}`] : []),
    '',
    business.receiptFooter,
  ];
  return lines.join('\n');
}

/** Digital receipt: the customer can read it off the screen or scan the QR to keep a copy. */
export function ReceiptDialog({
  sale,
  onClose,
  business,
  eventName,
  primaryLabel = 'New sale',
}: {
  sale: Sale | null;
  onClose: () => void;
  business: BusinessSettings;
  eventName: string;
  primaryLabel?: string;
}) {
  const [qr, setQr] = useState('');
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    setShowQr(false);
    if (!sale) return;
    QRCode.toDataURL(receiptText(sale, business, eventName), { margin: 1, width: 360, errorCorrectionLevel: 'L' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [sale, business, eventName]);

  if (!sale) return null;
  const cash = sale.payments.find((p) => p.kind === 'cash');
  return (
    <Dialog
      open={!!sale}
      onClose={onClose}
      title={`Sale ${sale.receiptNo}`}
      footer={
        <>
          {qr ? <Button onClick={() => setShowQr((v) => !v)}>{showQr ? 'Hide QR receipt' : 'Show QR receipt'}</Button> : null}
          <Button variant="primary" size="lg" onClick={onClose} autoFocus>
            {primaryLabel}
          </Button>
        </>
      }
    >
      {cash && sale.change > 0 ? (
        <div className="change-box big" role="status">
          <span>Give change</span>
          <b>{peso(sale.change)}</b>
        </div>
      ) : (
        <div className="change-box big good" role="status">
          <span>Paid</span>
          <b>{peso(sale.total)}</b>
        </div>
      )}
      {showQr && qr ? (
        <div className="center stack" style={{ justifyItems: 'center' }}>
          <img src={qr} alt="Receipt as a QR code" className="qr-img" style={{ width: 260, height: 260 }} />
          <p className="muted small">The customer scans this with their phone camera to keep the receipt.</p>
        </div>
      ) : null}
      <div className="receipt">
        <div className="center">
          <b>{business.name}</b>
          <div className="muted small">{eventName}</div>
          <div className="muted small">
            {sale.receiptNo} · {fmtDateTime(sale.at)}
          </div>
        </div>
        <hr className="divider" />
        {sale.lines.map((l, i) => (
          <div key={i} className="rline">
            <span>
              {l.qty} × {l.name}
              {l.free ? <em className="muted"> (free{l.freeReason ? `: ${l.freeReason}` : ''})</em> : null}
            </span>
            <span className="num">{l.free ? 'FREE' : peso(l.gross)}</span>
          </div>
        ))}
        {sale.discounts.map((d) => (
          <div key={d.id} className="rline good">
            <span>{d.label}</span>
            <span className="num">−{peso(d.amount)}</span>
          </div>
        ))}
        <hr className="divider" />
        <div className="rline total">
          <span>Total</span>
          <span className="num">{peso(sale.total)}</span>
        </div>
        {sale.payments.map((p, i) => (
          <div key={i} className="rline small">
            <span>
              {p.name}
              {p.ref ? <span className="muted"> · ref {p.ref}</span> : null}
            </span>
            <span className="num">{peso(p.tendered ?? p.amount)}</span>
          </div>
        ))}
        {sale.change ? (
          <div className="rline small">
            <span>Change</span>
            <span className="num">{peso(sale.change)}</span>
          </div>
        ) : null}
        {sale.note ? <p className="small muted">Note: {sale.note}</p> : null}
        <p className="center small muted">{business.receiptFooter}</p>
      </div>
    </Dialog>
  );
}
