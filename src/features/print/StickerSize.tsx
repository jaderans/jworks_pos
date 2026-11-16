import { Field, NumberInput } from '../../components/form';
import { Segmented } from '../../components/ui';
import { DEFAULT_PRINT_RATES, sheetsForStickers, sizeName, stickerFit } from '../../domain/print';
import type { CutArea, PrintRates } from '../../db/types';

/** The size the customer wants on a sticker sheets line, and whether they order by sheets or by stickers. */
export interface SizePick {
  /** '' = mixed designs, a size-guide name, or CUSTOM. */
  size: string;
  w: number | null;
  h: number | null;
  by: 'sheets' | 'stickers';
  stickers: number | null;
}

export const CUSTOM = '__custom';
export const blankSizePick = (): SizePick => ({ size: '', w: null, h: null, by: 'sheets', stickers: null });

/** The chosen size in inches, or null for mixed designs or an unfinished custom size. */
export function pickedSize(r: PrintRates, p: SizePick): { name: string; w: number; h: number } | null {
  if (p.size === CUSTOM) return p.w && p.h && p.w > 0 && p.h > 0 ? { name: sizeName(p.w, p.h), w: p.w, h: p.h } : null;
  return r.stickerSizes.find((s) => s.name === p.size) ?? null;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
export const areaText = (a: CutArea) => `${fmt(a.w)} × ${fmt(a.h)} in, ${fmt(a.gapMm)} mm apart`;

/**
 * The sticker sheets fields: the size (from the guide or the customer's own),
 * then A4 sheets or a sticker count, and a drawing of how they fit on the sheet.
 */
export function StickerSizeFields({
  rates,
  pick,
  onPick,
  sheets,
  onSheets,
  idPrefix = 'po',
}: {
  rates: PrintRates;
  pick: SizePick;
  onPick: (p: SizePick) => void;
  sheets: number | null;
  onSheets: (n: number | null) => void;
  idPrefix?: string;
}) {
  const area = rates.cutArea ?? DEFAULT_PRINT_RATES.cutArea;
  const size = pickedSize(rates, pick);
  const fit = size ? stickerFit(area, size.w, size.h) : null;
  const byCount = pick.by === 'stickers' && fit && fit.perA4 > 0 ? sheetsForStickers(pick.stickers ?? 0, fit.perA4) : null;
  const set = (ch: Partial<SizePick>) => onPick({ ...pick, ...ch });
  const id = (s: string) => `${idPrefix}-${s}`;

  return (
    <>
      <Field label="Sticker size (optional)" htmlFor={id('size')} hint={`Counts fit inside the Cricut cut area: ${areaText(area)}.`}>
        <select
          id={id('size')}
          className="select"
          value={pick.size}
          onChange={(e) => set({ size: e.target.value, ...(e.target.value ? {} : { by: 'sheets' as const }) })}
        >
          <option value="">Mixed designs</option>
          {rates.stickerSizes.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} · {stickerFit(area, s.w, s.h).perA4} per sheet
            </option>
          ))}
          <option value={CUSTOM}>Custom size…</option>
        </select>
      </Field>
      {pick.size === CUSTOM ? (
        <Field label="Their size (inches)" htmlFor={id('w')} hint="Width × height. Turned sideways when more fit that way.">
          <div className="size-wh">
            <NumberInput id={id('w')} ariaLabel="Sticker width in inches" min={0} value={pick.w} onChange={(w) => set({ w })} suffix="in" />
            <span aria-hidden="true">×</span>
            <NumberInput ariaLabel="Sticker height in inches" min={0} value={pick.h} onChange={(h) => set({ h })} suffix="in" />
          </div>
        </Field>
      ) : null}
      {size ? (
        <Field label="Order by">
          <Segmented
            label="Order by"
            value={pick.by}
            onChange={(by) => set({ by })}
            options={[
              { value: 'sheets', label: 'A4 sheets' },
              { value: 'stickers', label: 'Sticker count' },
            ]}
          />
        </Field>
      ) : null}
      {size && pick.by === 'stickers' ? (
        <Field
          label="How many stickers"
          htmlFor={id('stickers')}
          hint={byCount && byCount.sheets ? `${byCount.sheets} A4 sheet${byCount.sheets === 1 ? '' : 's'} make ${byCount.made}${byCount.spare ? `, ${byCount.spare} spare` : ''}.` : fit?.perA4 ? 'The A4 sheets are worked out from it.' : undefined}
        >
          <NumberInput id={id('stickers')} decimals={false} min={1} value={pick.stickers} onChange={(stickers) => set({ stickers })} />
        </Field>
      ) : (
        <Field label="A4 sheets" htmlFor={id('sheets')} hint={fit?.perA4 && sheets ? `About ${fit.perA4 * sheets} stickers.` : undefined}>
          <NumberInput id={id('sheets')} decimals={false} min={1} value={sheets} onChange={onSheets} />
        </Field>
      )}
      {size && fit ? (
        <div className="sheet-fit span-2">
          <SheetPreview area={area} w={size.w} h={size.h} />
          <div className="stack tight">
            {fit.perA4 > 0 ? (
              <>
                <b>
                  {fit.perA4} sticker{fit.perA4 === 1 ? '' : 's'} of {size.name} on one A4
                </b>
                <span className="muted small">
                  {fit.across} across × {fit.down} down{fit.rotated ? ', turned sideways' : ''}.
                </span>
              </>
            ) : (
              <b className="warn">Too big for the cut area ({fmt(area.w)} × {fmt(area.h)} in).</b>
            )}
            <span className="muted small">The dashed line is where the cutter can cut; the black marks around it are Cricut&rsquo;s registration marks.</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

const A4 = { w: 8.27, h: 11.69 };

/** One A4 sheet: the Print Then Cut area, its registration marks, and the stickers laid out inside. */
export function SheetPreview({ area, w, h, width = 120 }: { area: CutArea; w: number; h: number; width?: number }) {
  const fit = stickerFit(area, w, h);
  const x0 = (A4.w - area.w) / 2;
  const y0 = (A4.h - area.h) / 2;
  const g = Math.max(0, area.gapMm || 0) / 25.4;
  const [sw, sh] = fit.rotated ? [h, w] : [w, h];
  const gridW = fit.across * sw + Math.max(0, fit.across - 1) * g;
  const gridH = fit.down * sh + Math.max(0, fit.down - 1) * g;
  const gx = x0 + (area.w - gridW) / 2;
  const gy = y0 + (area.h - gridH) / 2;
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < fit.down; r++) for (let c = 0; c < fit.across; c++) cells.push({ x: gx + c * (sw + g), y: gy + r * (sh + g) });
  const m = 0.22;
  const k = 0.06;
  const L = 0.5;
  return (
    <svg className="sheet-preview" viewBox={`0 0 ${A4.w} ${A4.h}`} width={width} height={(width * A4.h) / A4.w} role="img" aria-label={`${fit.perA4} stickers of ${fmt(w)} × ${fmt(h)} in on an A4 sheet`}>
      <rect x={0} y={0} width={A4.w} height={A4.h} rx={0.08} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth={0.04} />
      {/* Cricut's registration marks: a square at the top left, corner brackets at the top right and bottom left. */}
      <rect x={x0 - m - 0.2} y={y0 - m - 0.2} width={0.2} height={0.2} fill="var(--ink)" />
      <path d={`M${x0 + area.w + m - L},${y0 - m} H${x0 + area.w + m} V${y0 - m + L}`} fill="none" stroke="var(--ink)" strokeWidth={k} />
      <path d={`M${x0 - m},${y0 + area.h + m - L} V${y0 + area.h + m} H${x0 - m + L}`} fill="none" stroke="var(--ink)" strokeWidth={k} />
      <rect x={x0} y={y0} width={area.w} height={area.h} fill="none" stroke="var(--teal)" strokeWidth={0.04} strokeDasharray="0.15 0.1" />
      {cells.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={sw} height={sh} rx={Math.min(sw, sh) * 0.12} fill="var(--teal-soft)" stroke="var(--teal)" strokeWidth={0.03} />
      ))}
    </svg>
  );
}

