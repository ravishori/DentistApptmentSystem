'use client';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, appointmentsApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Calendar, Users, DollarSign, AlertCircle, TrendingUp,
  TrendingDown, ArrowRight, Clock, CheckCircle2, Plus,
} from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency, formatDate } from '@/lib/utils';
import Link from 'next/link';

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({
  title, value, subtitle, icon: Icon, color, trend, trendLabel,
}: {
  title: string; value: string; subtitle?: string;
  icon: React.ElementType; color: string;
  trend?: number; trendLabel?: string;
}) {
  const positive = (trend ?? 0) >= 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1.5 leading-none">{value}</p>
            {subtitle && <p className="text-xs text-slate-400 mt-1.5">{subtitle}</p>}
            {trend !== undefined && (
              <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
                {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {positive ? '+' : ''}{trend}% {trendLabel ?? 'vs last month'}
              </div>
            )}
          </div>
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${color}`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Appointment row ───────────────────────────────────────────────────────────
function ApptRow({ appt }: { appt: any }) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-5 hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0">
      <div className="w-14 shrink-0 text-center">
        <p className="text-sm font-semibold text-slate-800">{appt.startTime?.slice(0, 5)}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">{appt.endTime?.slice(0, 5)}</p>
      </div>
      <div className="w-1 h-8 rounded-full bg-blue-200 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{appt.patient?.fullName}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {appt.type?.replace(/_/g, ' ')} · Dr. {appt.dentist?.fullName}
        </p>
      </div>
      <Badge variant={statusVariant(appt.status)} className="shrink-0">
        {appt.status?.replace(/_/g, ' ')}
      </Badge>
    </div>
  );
}

const PROCEDURE_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];

export default function DashboardPage() {
  const today = format(new Date(), 'EEEE, d MMMM yyyy');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn:  analyticsApi.dashboard,
  });
  const { data: apptChart } = useQuery({
    queryKey: ['appt-chart'],
    queryFn:  () => analyticsApi.appointmentChart(14),
  });
  const { data: revenueChart } = useQuery({
    queryKey: ['revenue-chart'],
    queryFn:  () => analyticsApi.revenueChart(6),
  });
  const { data: procedures } = useQuery({
    queryKey: ['top-procedures'],
    queryFn:  analyticsApi.topProcedures,
  });
  const { data: todaySchedule } = useQuery({
    queryKey: ['today-schedule'],
    queryFn:  () => appointmentsApi.list({ date: format(new Date(), 'yyyy-MM-dd'), limit: 8 }),
  });

  return (
    <div>
      <Header
        title="Dashboard"
        subtitle={today}
        actions={
          <Button size="sm" asChild>
            <Link href="/appointments">
              <Plus className="w-3.5 h-3.5" />
              New Appointment
            </Link>
          </Button>
        }
      />

      <div className="page-content">
        {/* ── KPI row ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-20" /></CardContent></Card>
            ))
          ) : (
            <>
              <KpiCard
                title="Today's Appointments"
                value={String(stats?.today?.appointments ?? 0)}
                subtitle={`${stats?.today?.completed ?? 0} completed · ${stats?.today?.pending ?? 0} pending`}
                icon={Calendar} color="bg-blue-500"
                trend={stats?.thisMonth?.appointmentGrowth}
              />
              <KpiCard
                title="This Month Revenue"
                value={formatCurrency(stats?.thisMonth?.revenue ?? 0)}
                subtitle="Net collections"
                icon={DollarSign} color="bg-emerald-500"
                trend={stats?.thisMonth?.revenueMoMPercent}
              />
              <KpiCard
                title="Total Patients"
                value={(stats?.totals?.patients ?? 0).toLocaleString('en-IN')}
                subtitle={`+${stats?.thisMonth?.newPatients ?? 0} new this month`}
                icon={Users} color="bg-purple-500"
                trend={stats?.thisMonth?.patientGrowth}
              />
              <KpiCard
                title="Outstanding"
                value={formatCurrency(stats?.totals?.outstandingAmount ?? 0)}
                subtitle={`${stats?.totals?.pendingInvoices ?? 0} pending invoices`}
                icon={AlertCircle} color="bg-orange-500"
              />
            </>
          )}
        </div>

        {/* ── Charts row ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Revenue trend */}
          <Card className="xl:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Revenue Trend</CardTitle>
                <span className="text-xs text-slate-400">Last 6 months</span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenueChart ?? []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} width={48} />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 12 }}
                    formatter={(v: any) => [formatCurrency(Number(v)), 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#revenueGrad)" dot={false} activeDot={{ r: 5 }} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top procedures pie */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Top Procedures</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={procedures ?? []}
                    dataKey="count" nameKey="name"
                    cx="50%" cy="45%" innerRadius={50} outerRadius={80}
                    paddingAngle={3}
                  >
                    {(procedures ?? []).map((_: any, i: number) => (
                      <Cell key={i} fill={PROCEDURE_COLORS[i % PROCEDURE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 12 }} />
                  <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* ── Appointments bar chart + today schedule ───────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>Appointments</CardTitle>
                <span className="text-xs text-slate-400">Last 14 days</span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={apptChart ?? []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => format(new Date(v), 'dd/MM')} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #E2E8F0', fontSize: 12 }}
                    labelFormatter={(v) => format(new Date(v), 'd MMM')} />
                  <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Today's schedule */}
          <Card className="xl:col-span-2">
            <div className="flex items-center justify-between p-5 pb-0">
              <CardTitle>Today&apos;s Schedule</CardTitle>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/appointments" className="text-blue-600 text-xs font-medium">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </Button>
            </div>
            <div className="mt-3">
              {todaySchedule?.items?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <CheckCircle2 className="w-10 h-10 mb-2 text-slate-200" />
                  <p className="text-sm">No appointments today</p>
                </div>
              ) : (
                todaySchedule?.items?.map((a: any) => <ApptRow key={a.id} appt={a} />)
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
