import type { Route } from 'next';
import {
  LayoutDashboard, Calendar, Users, Receipt, Stethoscope,
  MessageCircle, BarChart2, Settings, Building2,
} from 'lucide-react';

/** Single source for the sidebar and the command palette (so both always list the same destinations). */
export const NAV: { href: Route; label: string; icon: typeof LayoutDashboard }[] = [
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
