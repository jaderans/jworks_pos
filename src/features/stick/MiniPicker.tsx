import { useMemo } from 'react';
import { MINI_STICKERS } from '../../domain/miniStickers';

/** The mini sticker pictures, by number: "07" → its 240 px image. */
const PICS = Object.fromEntries(
  Object.entries(import.meta.glob('../../assets/mini-stickers/*.webp', { eager: true, import: 'default' }) as Record<string, string>).map(([path, url]) => [
    path.split('/').pop()!.slice(0, 2),
    url,
  ]),
);

export const miniPic = (no: string): string | undefined => PICS[no];

/**
 * Pick the bonus mini stickers for a pack: the designs by theme, up to as
 * many as the pack comes with. Tap again to take one off.
 */
export function MiniPicker({ value, max, onChange, label }: { value: string[]; max: number; onChange: (v: string[]) => void; label: string }) {
  const themes = useMemo(() => {
    const out = new Map<string, typeof MINI_STICKERS[number][]>();
    for (const m of MINI_STICKERS) out.set(m.theme, [...(out.get(m.theme) ?? []), m]);
    return [...out];
  }, []);
  const full = value.length >= max;
  return (
    <div className="mini-picker" role="group" aria-label={label}>
      <p className="mini-count small">
        <b>
          {value.length} of {max}
        </b>{' '}
        mini stickers picked{full ? '. Tap one to take it off.' : '.'}
      </p>
      {themes.map(([theme, list]) => (
        <div key={theme} className="mini-theme">
          <span className="mini-theme-name">{theme}</span>
          <div className="mini-grid">
            {list.map((m) => {
              const on = value.includes(m.no);
              return (
                <button
                  key={m.no}
                  type="button"
                  className={`mini${on ? ' on' : ''}`}
                  aria-pressed={on}
                  aria-label={`${m.no} ${m.name}`}
                  disabled={!on && full}
                  onClick={() => onChange(on ? value.filter((x) => x !== m.no) : [...value, m.no])}
                >
                  {PICS[m.no] ? <img src={PICS[m.no]} alt="" loading="lazy" /> : null}
                  <span>
                    {m.no} {m.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
