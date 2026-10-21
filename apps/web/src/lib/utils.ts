import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style:    'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (style === 'short')  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  if (style === 'long')   return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    scheduled:   'badge-blue',
    confirmed:   'badge-teal',
    in_progress: 'badge-yellow',
    completed:   'badge-green',
    cancelled:   'badge-red',
    no_show:     'badge-gray',
    rescheduled: 'badge-purple',
    draft:       'badge-gray',
    sent:        'badge-blue',
    partial:     'badge-yellow',
    paid:        'badge-green',
  };
  return map[status] ?? 'badge-gray';
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return formatDate(d, 'short');
}

/** "Dr. Name" without doubling the title when the stored name already starts with it. */
export function formatDentist(name?: string | null): string {
  const n = (name ?? '').trim();
  if (!n) return 'Dentist';
  return /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`;
}
