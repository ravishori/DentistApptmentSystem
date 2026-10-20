'use client';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Calendar, Users, Receipt, Stethoscope,
  MessageCircle, BarChart2, Settings, LogOut, Zap, X, Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useEffect } from 'react';

const NAV: { href: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/appointments', label: 'Appointments',  icon: Calendar },
  { href: '/patients',     label: 'Patients',      icon: Users },
  { href: '/treatments',   label: 'Treatments',    icon: Stethoscope },
  { href: '/billing',      label: 'Billing',       icon: Receipt },
  { href: '/clinic',       label: 'Clinic Mgmt',   icon: Building2 },
  { href: '/whatsapp',     label: 'WhatsApp',      icon: MessageCircle },
  { href: '/analytics',    label: 'Reports',       icon: BarChart2 },
  { href: '/settings',     label: 'Settings',      icon: Settings },
];

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
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-blue-900/30">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-white text-sm truncate">{tenant?.clinicName || 'DentalEase'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <p className="text-xs text-slate-400 capitalize">{tenant?.plan ?? 'pro'} plan</p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" className="md:hidden text-slate-400 hover:text-white" onClick={onClose} aria-label="Close navigation menu">
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
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {label}
                {label === 'WhatsApp' && (
                  <Badge variant="teal" className="ml-auto text-[10px] px-1.5 py-0">NEW</Badge>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-blue-700 text-white text-xs">
                {user?.fullName ? getInitials(user.fullName) : '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.fullName}</p>
              <p className="text-slate-400 text-xs capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded p-1.5 text-slate-400 transition-colors hover:text-white"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
