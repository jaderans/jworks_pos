import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Clock, Mail, XCircle } from 'lucide-react';
import lockupLight from '../../assets/brand/lockup-on-light.png';
import lockupDark from '../../assets/brand/lockup-on-dark.png';
import { useApp } from '../../app/AppContext';
import { db } from '../../db/db';
import { Dialog } from '../../components/Dialog';
import { Button } from '../../components/ui';
import { Check, TextInput } from '../../components/form';
import { getMailer, isEmail, mailerReady } from '../../email/send';
import { flushOutbox, queueEmail } from '../../email/outbox';
import { saleReceiptEmail } from '../../email/templates';
import { saveCustomer } from '../../services/customers';
import { peso } from '../../lib/money';
import { fmtDateTime } from '../../lib/time';
import { useCustomerSales, useCustomers, useSettingRows } from '../../hooks/data';
import { settingValue } from '../../db/settings';
import { loyaltyState, rewardText, stampsForSale } from '../../domain/loyalty';
import type { BusinessSettings, LoyaltySettings, Sale } from '../../db/types';

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
  const customers = useCustomers();
  const customerSales = useCustomerSales();
  const rules = settingValue<LoyaltySettings>(useSettingRows(), 'loyalty');
  const app = useApp();
  const customer = useMemo(() => (sale?.customerId ? customers?.find((c) => c.id === sale.customerId) : undefined), [sale?.customerId, customers]);
  const [emailTo, setEmailTo] = useState('');
  const [saveEmail, setSaveEmail] = useState(true);
  const [sending, setSending] = useState(false);
  const [mailerOk, setMailerOk] = useState<boolean | null>(null);
  const emails = useLiveQuery(async () => (sale ? db.outbox.where('saleId').equals(sale.id).sortBy('at') : []), [sale?.id]);

  useEffect(() => {
    setEmailTo(customer?.email ?? '');
    setSaveEmail(true);
  }, [sale?.id, customer?.email]);
  useEffect(() => {
    if (sale) void getMailer().then((m) => setMailerOk(mailerReady(m)));
  }, [sale]);

  useEffect(() => {
    setShowQr(false);
    if (!sale) return;
    QRCode.toDataURL(receiptText(sale, business, eventName), { margin: 1, width: 360, errorCorrectionLevel: 'L' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [sale, business, eventName]);

  if (!sale) return null;
  const cash = sale.payments.find((p) => p.kind === 'cash');
  const card = customer && rules.enabled ? loyaltyState(customer.id, customerSales ?? [], rules) : null;
  const earned = card ? stampsForSale(sale, rules) : 0;
  const stampLine = card ? `+${earned} stamp${earned === 1 ? '' : 's'}, ${card.balance} on the card${card.rewards ? ` · ${rewardText(rules)} ready next time` : ` · ${card.toNext} more for ${rewardText(rules)}`}` : undefined;
  const last = emails?.[emails.length - 1];

  const sendReceipt = async () => {
    const to = emailTo.trim().toLowerCase();
    if (!isEmail(to)) return;
    setSending(true);
    try {
      if (customer && !customer.email && saveEmail) await saveCustomer({ ...customer, email: to });
      await queueEmail({ kind: 'receipt', saleId: sale.id, to, toName: customer?.name ?? '', mail: saleReceiptEmail(business, sale, { eventName, customerName: customer?.name, stampLine }) });
      const r = await flushOutbox();
      app.toast(r.sent ? `Receipt emailed to ${to}` : 'Receipt saved; it goes out when there’s a connection.', { tone: r.sent ? 'good' : 'info' });
    } finally {
      setSending(false);
    }
  };
  return (
    <Dialog
      open={!!sale}
      onClose={onClose}
      title={`Sale ${sale.receiptNo}`}
      initialFocus=".dialog-foot .btn.primary"
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
        <div className="center receipt-head">
          <img className="receipt-lockup only-light" src={lockupLight} alt={business.name || 'JoshWorks'} />
          <img className="receipt-lockup only-dark" src={lockupDark} alt="" aria-hidden="true" />
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
        {customer ? (
          <p className="small">
            For <b>{customer.name}</b>
            {card ? (
              <span className="muted">
                {' '}
                · +{earned} stamp{earned === 1 ? '' : 's'}, {card.balance} on the card
                {card.rewards ? ` · ${rewardText(rules)} ready next time` : ` · ${card.toNext} more for ${rewardText(rules)}`}
              </span>
            ) : null}
          </p>
        ) : null}
        {sale.note ? <p className="small muted">Note: {sale.note}</p> : null}
        <p className="center small muted">{business.receiptFooter}</p>
      </div>
      <div className="email-receipt">
        <label className="label strong small" htmlFor="rc-email">
          Email the receipt
        </label>
        <div className="row">
          <TextInput
            id="rc-email"
            type="email"
            inputMode="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendReceipt();
            }}
            placeholder="customer@gmail.com"
            disabled={mailerOk === false}
          />
          <Button onClick={sendReceipt} disabled={!isEmail(emailTo) || sending || mailerOk === false}>
            <Mail size={16} /> Send
          </Button>
        </div>
        {customer && !customer.email && isEmail(emailTo) ? (
          <Check id="rc-save" checked={saveEmail} onChange={setSaveEmail} label={`Save it to ${customer.name}’s details`} />
        ) : null}
        {last ? (
          <p className={`small row ${last.status === 'sent' ? 'good' : last.status === 'failed' ? 'bad' : 'warn'}`} style={{ gap: 6 }} role="status">
            {last.status === 'sent' ? <CheckCircle2 size={16} /> : last.status === 'failed' ? <XCircle size={16} /> : <Clock size={16} />}
            {last.status === 'sent' ? `Emailed to ${last.to}` : last.status === 'failed' ? `Didn’t send to ${last.to}: ${last.error}` : `Waiting to send to ${last.to}. It goes out when there’s a connection.`}
          </p>
        ) : null}
        {mailerOk === false ? (
          <p className="muted small">{app.can('settings') ? 'Set up the studio Gmail in Settings → Email to email receipts.' : 'Ask the owner to set up emailed receipts.'}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
