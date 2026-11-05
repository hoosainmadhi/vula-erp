import {
  useEffect,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { statusColours, titleCase } from '../lib/format';

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-100 disabled:text-slate-500';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';

export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50';

export const btnGhost =
  'inline-flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100';

export function PasswordInput({
  value,
  onChange,
  className = '',
  leftIcon,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  leftIcon?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      {leftIcon ? (
        <span className="pointer-events-none absolute left-3 top-2.5">{leftIcon}</span>
      ) : null}
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={`${inputCls} pr-11 ${leftIcon ? 'pl-9' : ''} ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1.5 top-1.5 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
      <Loader2 className="size-5 animate-spin" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/70 sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`safe-top flex max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl sm:border sm:border-slate-200 ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Close (Esc)"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Badge({ value }: { value: string }) {
  const colour = statusColours[value] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${colour}`}>
      {titleCase(value)}
    </span>
  );
}

export function EmptyState({ message, colSpan }: { message: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-400">
        {message}
      </td>
    </tr>
  );
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export const thCls =
  'border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500';
export const tdCls = 'border-b border-slate-100 px-3 py-2.5 align-middle';
