import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let openCount = 0;

/** Modal dialog; a bottom sheet on phones. Escape and the backdrop close it unless `locked`. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size,
  locked,
  fullPhone,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'wide' | 'xwide';
  locked?: boolean;
  fullPhone?: boolean;
  initialFocus?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    openCount++;
    document.body.style.overflow = 'hidden';
    document.body.dataset.dialogOpen = 'true';
    const t = window.setTimeout(() => {
      const root = ref.current;
      if (!root) return;
      const target =
        (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ??
        root.querySelector<HTMLElement>('[autofocus], .dialog-body input:not([type=hidden]):not([disabled]), .dialog-body select, .dialog-body textarea') ??
        root.querySelector<HTMLElement>('.dialog-body button, .dialog-foot button') ??
        root;
      target.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key === 'Tab' && ref.current) {
        const focusables = Array.from(ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
          (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      openCount = Math.max(0, openCount - 1);
      if (openCount === 0) {
        document.body.style.overflow = '';
        delete document.body.dataset.dialogOpen;
      }
      previous?.focus?.();
    };
  }, [open, locked, initialFocus]);

  if (!open) return null;
  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div ref={ref} className={`dialog ${size ?? ''} ${fullPhone ? 'full-phone' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          {!locked ? (
            <button type="button" className="icon-btn plain sm" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          ) : null}
        </div>
        <div className="dialog-body">{children}</div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export const isDialogOpen = () => document.body.dataset.dialogOpen === 'true';
