'use client';
import { Bell, Search, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { ThemeMenu } from './theme-selector';
import { useSidebar } from './sidebar-context';
import { OPEN_COMMAND_PALETTE_EVENT } from './command-palette';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** Optional override; defaults to opening the shared mobile navigation drawer. */
  onMenuClick?: () => void;
}

export function Header({ title, subtitle, actions, onMenuClick }: HeaderProps) {
  const { user } = useAuth();
  const sidebar = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card/95 px-4 py-2 backdrop-blur md:px-6">
      {/* Mobile menu toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 md:hidden"
        onClick={onMenuClick ?? (() => sidebar.setOpen(true))}
        aria-label="Open navigation menu"
        aria-expanded={sidebar.open}
        aria-controls="app-sidebar"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      <div className="order-1 min-w-0 flex-1 sm:order-none">
        <h1 className="truncate font-display text-lg font-semibold text-foreground md:text-xl">{title}</h1>
        {subtitle && <p className="hidden text-xs text-muted-foreground sm:block">{subtitle}</p>}
      </div>

      {/* Page actions: second full-width row on phones, inline from sm up */}
      {actions && (
        <div className="order-3 flex w-full items-center gap-1.5 overflow-x-auto sm:order-none sm:w-auto sm:overflow-visible">{actions}</div>
      )}

      <div className="order-2 flex items-center gap-1.5 sm:order-none">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search pages and actions (Ctrl+K)"
          title="Search (Ctrl+K)"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>

        <ThemeMenu />

        <Button variant="ghost" size="icon" className="relative hidden sm:inline-flex" aria-label="Notifications" title="Notifications">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Button>

        <Avatar className="ml-1 hidden h-8 w-8 sm:flex">
          <AvatarFallback className="text-xs" aria-label={user?.fullName ?? 'User'}>
            {user?.fullName ? getInitials(user.fullName) : '?'}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
