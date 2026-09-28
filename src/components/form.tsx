import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { parseMoney, type Cents } from '../lib/money';

export function Field({ label, hint, error, htmlFor, children, className = '' }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="label">{label}</span>}
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({ className = '', inputRef, ...rest }: InputHTMLAttributes<HTMLInputElement> & { inputRef?: Ref<HTMLInputElement> }) {
  return <input ref={inputRef} className={`input ${className}`} {...rest} />;
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
}

const editText = (c: Cents | null | undefined) => (c === null || c === undefined ? '' : String(Math.round(c) / 100));

/** Peso input: people type pesos, the app stores centavos. */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder,
  large,
  disabled,
  autoFocus,
  onEnter,
  inputRef,
  ariaLabel,
}: {
  value: Cents | null | undefined;
  onChange: (c: Cents | null) => void;
  id?: string;
  placeholder?: string;
  large?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(editText(value));
  const last = useRef<Cents | null | undefined>(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(editText(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className={`affix ${large ? 'lg' : ''}`}>
      <span aria-hidden="true">₱</span>
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? '0'}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseMoney(e.target.value);
          last.current = c;
          onChange(c);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </div>
  );
}

/** Whole or decimal number input with an optional unit after it. */
export function NumberInput({
  value,
  onChange,
  id,
  suffix,
  prefix,
  placeholder,
  decimals = true,
  min,
  disabled,
  ariaLabel,
  autoFocus,
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
  id?: string;
  suffix?: string;
  prefix?: string;
  placeholder?: string;
  decimals?: boolean;
  min?: number;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(value === null || value === undefined ? '' : String(value));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="affix">
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode={decimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        placeholder={placeholder ?? '0'}
        value={text}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const cleaned = t.replace(/,/g, '').trim();
          if (cleaned === '') {
            last.current = null;
            onChange(null);
            return;
          }
          let n = Number(cleaned);
          if (!Number.isFinite(n)) return;
          if (!decimals) n = Math.trunc(n);
          if (min !== undefined && n < min) n = min;
          last.current = n;
          onChange(n);
        }}
      />
      {suffix ? (
        <span className="after" aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Check({ checked, onChange, label, sub, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; sub?: ReactNode; id: string; disabled?: boolean }) {
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {sub ? <span className="sub">{sub}</span> : null}
      </span>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  inputRef,
  id,
  onKeyDown,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="search">
      <Search size={18} aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        className="input"
        type="search"
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
