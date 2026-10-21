'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { LogOut, Palette, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { THEMES } from '@/lib/theme';
import { useTheme } from '@/lib/use-theme';
import { cn } from '@/lib/utils';
import { NAV } from './nav-items';

export const OPEN_COMMAND_PALETTE_EVENT = 'dentalease:open-command-palette';

interface Item { id: string; group: string; label: string; icon: React.ElementType; run: () => void }

/** Ctrl/Cmd+K palette: go to any page, switch theme, sign out. Same destinations as the sidebar. */
export function CommandPalette() {
  const router = useRouter();
  const { logout } = useAuth();
  const { setChoice } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen); };
  }, []);

  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);

  const items = useMemo<Item[]>(() => [
    ...NAV.map((n): Item => ({ id: `go-${n.href}`, group: 'Go to', label: n.label, icon: n.icon, run: () => router.push(n.href) })),
    ...THEMES.map((t): Item => ({ id: `theme-${t.id}`, group: 'Theme', label: `Theme: ${t.label}`, icon: Palette, run: () => setChoice(t.id) })),
    { id: 'theme-system', group: 'Theme', label: 'Theme: Match system', icon: Palette, run: () => setChoice('system') },
    { id: 'logout', group: 'Account', label: 'Sign out', icon: LogOut, run: () => { logout(); router.push('/login'); } },
  ], [router, setChoice, logout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => `${i.group} ${i.label}`.toLowerCase().includes(q)) : items;
  }, [items, query]);

  useEffect(() => { setActive((a) => Math.min(a, Math.max(filtered.length - 1, 0))); }, [filtered.length]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const choose = (item?: Item) => { if (!item) return; setOpen(false); item.run(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (filtered.length ? (a + 1) % filtered.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (filtered.length ? (a - 1 + filtered.length) % filtered.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[10vh] z-[60] w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-popover"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="command-list"
              aria-activedescendant={filtered[active] ? `cmd-${filtered[active].id}` : undefined}
              aria-label="Search pages and actions"
              placeholder="Search pages and actions…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKeyDown}
              className="h-12 w-full border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
            />
            <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">Esc</kbd>
          </div>
          <ul id="command-list" ref={listRef} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground" role="presentation">No matching pages or actions.</li>}
            {filtered.map((item, i) => {
              const Icon = item.icon;
              const showGroup = i === 0 || filtered[i - 1].group !== item.group;
              return (
                <li key={item.id} role="presentation">
                  {showGroup && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.group}</p>}
                  <div
                    id={`cmd-${item.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cn('flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-3 text-sm', i === active ? 'bg-accent text-accent-foreground' : '')}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {item.label}
                  </div>
                </li>
              );
            })}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
