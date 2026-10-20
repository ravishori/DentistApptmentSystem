'use client';
import { Bell, Search, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onMenuClick?: () => void;
}

export function Header({ title, subtitle, actions, onMenuClick }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center px-4 md:px-6 gap-3">
      {/* Mobile menu toggle */}
      <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={onMenuClick}>
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex-1 min-w-0">
        <h1 className="text-base md:text-lg font-semibold text-slate-900 truncate">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 hidden sm:block">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-1.5">
        {actions}

        <Button variant="ghost" size="icon" title="Search">
          <Search className="w-4 h-4" />
        </Button>

        <Button variant="ghost" size="icon" className="relative" title="Notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full ring-1 ring-white" />
        </Button>

        <Avatar className="h-8 w-8 cursor-pointer ml-1">
          <AvatarFallback className="text-xs">
            {user?.fullName ? getInitials(user.fullName) : '?'}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
