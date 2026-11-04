import { CouponsView } from '../coupons/CouponsView';
import type { JWEvent } from '../../db/types';

/** Event → Coupons: this event's service coupons. */
export default function CouponsTab({ ev }: { ev: JWEvent }) {
  return <CouponsView eventId={ev.id} />;
}
