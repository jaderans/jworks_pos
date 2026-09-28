import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { isDialogOpen } from './Dialog';

/** A dropdown panel under a button (account menu, activity). Closes on outside tap, Escape, or navigation. */
export function Popover({
  label,
  buttonClass,
  button,
  children,
  onOpenChange,
}: {
  label: string;
  buttonClass: string;
  button: ReactNode;
  children: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const location = useLocation();
  const changed = useRef(onOpenChange);
  changed.current = onOpenChange;

  const setOpen = (v: boolean) => {
    setOpenState(v);
    changed.current?.(v);
  };

  useEffect(() => {
    setOpenState(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('button, [href], input, select')?.focus(), 20);
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpenState(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDialogOpen()) {
        setOpenState(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pop" ref={wrap}>
      <button ref={btn} type="button" className={buttonClass} aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open ? (
        <div id={id} ref={panel} className="pop-panel" role="region" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
