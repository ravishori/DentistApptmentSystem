'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LogOut, Zap, X } from 'lucide-react';
import { NAV } from './nav-items';
import { useAuth } from '@/lib/auth';
import { getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useEffect } from 'react';

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, tenant, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => { logout(); router.push('/login'); };

  // Escape closes the mobile drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      <aside id="app-sidebar" aria-label="Primary" className={cn(
        'fixed left-0 top-0 h-screen w-[260px] bg-sidebar flex flex-col z-50 transition-transform duration-200',
        'md:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}>
        {/* Brand */}
        <div className="p-5 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shrink-0 shadow-lg">
              <Zap className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sidebar-foreground text-sm truncate">{tenant?.clinicName || 'DentalEase'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true"></span>
                <p className="text-xs text-sidebar-muted capitalize">{tenant?.plan ?? 'pro'} plan</p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="md:hidden text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground" onClick={onClose} aria-label="Close navigation menu">
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[44px] items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  active
                    ? 'bg-[hsl(var(--sidebar-active)/0.18)] text-sidebar-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-sidebar-active'
                    : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {label}
                {label === 'WhatsApp' && (
                  <span className="ml-auto rounded-full bg-[hsl(var(--sidebar-active)/0.25)] px-1.5 text-[10px] font-semibold text-sidebar-foreground">NEW</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {user?.fullName ? getInitials(user.fullName) : '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sidebar-foreground text-sm font-medium truncate">{user?.fullName}</p>
              <p className="text-sidebar-muted text-xs capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded p-2 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
