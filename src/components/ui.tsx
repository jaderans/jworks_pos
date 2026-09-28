import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

type Variant = 'default' | 'primary' | 'teal' | 'danger' | 'ghost' | 'link';

export function Button({
  variant = 'default',
  size,
  block,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; block?: boolean }) {
  const cls = ['btn', variant !== 'default' ? variant : '', size ?? '', block ? 'block' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  size,
  plain,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: 'sm'; plain?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} className={['icon-btn', size ?? '', plain ? 'plain' : '', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone, children, title }: { tone?: 'teal' | 'yellow' | 'good' | 'warn' | 'bad' | 'outline'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone ?? ''}`} title={title}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, hero }: { label: string; value: ReactNode; hint?: ReactNode; hero?: boolean }) {
  return (
    <div className={`stat ${hero ? 'hero' : ''}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, eyebrow, actions }: { title: ReactNode; subtitle?: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="titles">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
  label,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  full?: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id: string; disabled?: boolean }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function Callout({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode; title?: ReactNode }) {
  const Icon = tone === 'warn' ? AlertTriangle : tone === 'bad' ? XCircle : tone === 'good' ? CheckCircle2 : Info;
  return (
    <div className={`callout ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon size={18} aria-hidden="true" />
      <div className="body stack tight">
        {title ? <b>{title}</b> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ items }: { items: { to: string; label: ReactNode; end?: boolean }[] }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Initials({ name, size }: { name: string; size?: 'lg' }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const text = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span className={`avatar ${size ?? ''}`} aria-hidden="true">
      {text}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading">{label}</div>;
}
