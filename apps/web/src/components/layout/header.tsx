'use client';
import { Bell, Search, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { ThemeToggle } from './theme-toggle';
import { useSidebar } from './sidebar-context';

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
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur md:px-6">
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

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-foreground md:text-lg">{title}</h1>
        {subtitle && <p className="hidden text-xs text-muted-foreground sm:block">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-1.5">
        {actions}

        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Search" title="Search">
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>

        <ThemeToggle />

        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications" title="Notifications">
          <Bell className="h-4 w-4" aria-hidden="true" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-destructive ring-1 ring-card" aria-hidden="true" />
        </Button>

        <Avatar className="ml-1 h-8 w-8">
          <AvatarFallback className="text-xs" aria-label={user?.fullName ?? 'User'}>
            {user?.fullName ? getInitials(user.fullName) : '?'}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
