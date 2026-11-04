import { useEffect, useState } from 'react';
import { Ticket, X } from 'lucide-react';
import { Button, IconButton } from '../../components/ui';
import { Field, TextInput } from '../../components/form';
import { peso, type Cents } from '../../lib/money';
import { normalizeCode } from '../../domain/loyalty';
import type { CouponCheck } from '../../domain/coupons';
import { checkCouponCode } from '../../services/coupons';
import type { AppliedCoupon } from '../../db/types';

/** Checks a coupon code against a service's price as the price changes. null while there's no code. */
export function useCouponCheck(code: string, price: Cents, claim: string | null): CouponCheck | null {
  const [check, setCheck] = useState<CouponCheck | null>(null);
  useEffect(() => {
    if (!code) {
      setCheck(null);
      return;
    }
    let live = true;
    void checkCouponCode(code, price, claim).then((r) => {
      if (live) setCheck(r);
    });
    return () => {
      live = false;
    };
  }, [code, price, claim]);
  return check;
}

/** What a passing check puts on the service, for its totals. */
export const appliedFrom = (check: CouponCheck | null): AppliedCoupon | null => (check?.ok ? { couponId: check.coupon.id, code: check.coupon.code, discount: check.discount } : null);

/** Type a service coupon, or see the one on it with what it takes off (or why it doesn't fit). */
export function CouponField({ id, code, onCode, check, hint }: { id: string; code: string; onCode: (code: string) => void; check: CouponCheck | null; hint?: string }) {
  const [typed, setTyped] = useState('');
  const apply = () => {
    const c = normalizeCode(typed);
    if (!c) return;
    onCode(c);
    setTyped('');
  };
  if (code)
    return (
      <div className={`coupon-on ${check && !check.ok ? 'bad' : ''}`} role="status">
        <Ticket size={18} />
        <span className="grow">
          {/* The reasons a code doesn't fit already name it. */}
          {check && !check.ok ? (
            <span className="bad">{check.reason}</span>
          ) : (
            <>
              <b>{code}</b> {check?.ok ? <span>{peso(check.discount)} off</span> : <span className="muted">Checking…</span>}
            </>
          )}
        </span>
        <IconButton label="Remove the coupon" size="sm" onClick={() => onCode('')}>
          <X size={16} />
        </IconButton>
      </div>
    );
  return (
    <Field label="Service coupon" htmlFor={id} hint={hint ?? 'A code from a JoshWorks event, for services of ₱2,500 or more.'}>
      <div className="row">
        <TextInput
          id={id}
          className="grow"
          value={typed}
          autoCapitalize="characters"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="e.g. KI26-7F3QX"
        />
        <Button onClick={apply} disabled={!typed.trim()}>
          Apply
        </Button>
      </div>
    </Field>
  );
}
