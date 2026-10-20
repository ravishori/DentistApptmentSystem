'use client';
import React, { useState, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell,
  Legend, LineChart, Line,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, Users, Calendar,
  AlertTriangle, Star, Download, FileText, Activity,
  UserX, Crown, ChevronRight,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { RevenueTrendCard, useRevenueAccess } from '@/components/analytics/RevenueTrendCard';
import { RevenueAccessManager } from '@/components/analytics/RevenueAccessManager';

// ── Constants ──────────────────────────────────────────────────────────────────

const CHART_COLORS = {
  blue:   '#3B82F6',
  green:  '#10B981',
  purple: '#8B5CF6',
  amber:  '#F59E0B',
  red:    '#EF4444',
  teal:   '#14B8A6',
  indigo: '#6366F1',
  pink:   '#EC4899',
};
const PIE_PALETTE = Object.values(CHART_COLORS);

const TABS = ['Overview', 'Revenue', 'Patients', 'Insights'] as const;
type Tab = typeof TABS[number];

const TREND_PERIODS = [
  { label: '3 mo', count: 3  },
  { label: '6 mo', count: 6  },
  { label: '12 mo', count: 12 },
  { label: '2 yr',  count: 24 },
] as const;

// ── Small helpers ──────────────────────────────────────────────────────────────

function pctChange(cur: number, prev: number) {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Reusable sub-components ────────────────────────────────────────────────────

function KpiCard({
  label, value, subValue, change, icon: Icon, color, loading,
}: {
  label: string; value: string; subValue?: string;
  change?: number; icon: React.ElementType; color: string; loading?: boolean;
}) {
  if (loading) return (
    <Card><CardContent className="p-5"><Skeleton className="h-[72px]" /></CardContent></Card>
  );
  const up = (change ?? 0) >= 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider truncate">{label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1 leading-tight">{value}</p>
            {subValue && <p className="text-xs text-slate-500 mt-0.5">{subValue}</p>}
            {change !== undefined && (
              <div className={`flex items-center gap-1 mt-1.5 text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-500'}`}>
                {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {up ? '+' : ''}{change}% vs last month
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

function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div>
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PeriodPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 bg-slate-100 p-0.5 rounded-lg">
      {TREND_PERIODS.map(p => (
        <button key={p.label} onClick={() => onChange(p.count)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            value === p.count ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
          }`}
        >{p.label}</button>
      ))}
    </div>
  );
}

// Custom tooltip
const ChartTip = ({ active, payload, label, currency }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2.5 text-xs">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: <strong>{currency ? formatCurrency(Number(p.value)) : p.value}</strong>
        </p>
      ))}
    </div>
  );
};

// ── OVERVIEW TAB ───────────────────────────────────────────────────────────────

function OverviewTab({ trendCount }: { trendCount: number }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn:  analyticsApi.dashboard,
  });
  const { data: trends } = useQuery({
    queryKey: ['analytics-trends', 'monthly', trendCount],
    queryFn:  () => analyticsApi.trends('monthly', trendCount),
  });
  const { data: funnel } = useQuery({
    queryKey: ['analytics-funnel'],
    queryFn:  () => analyticsApi.conversionFunnel(3),
  });
  const { data: dentists } = useQuery({
    queryKey: ['analytics-dentists'],
    queryFn:  () => analyticsApi.dentistPerformance(3),
  });

  const noShowRate = stats?.noShowRate ?? 0;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className={`grid grid-cols-2 gap-3 md:gap-4 ${stats?.financialsRestricted ? 'xl:grid-cols-2' : 'xl:grid-cols-4'}`}>
        {!stats?.financialsRestricted && <KpiCard loading={isLoading} label="Month Revenue" icon={DollarSign} color="bg-emerald-500"
          value={formatCurrency(stats?.thisMonth?.revenue ?? 0)}
          change={stats?.thisMonth?.revenueMoM}
        />}
        <KpiCard loading={isLoading} label="Appointments" icon={Calendar} color="bg-blue-500"
          value={String(stats?.thisMonth?.appointments ?? 0)}
          subValue={`Today: ${stats?.today?.appointments ?? 0}`}
          change={stats?.thisMonth?.appointmentGrowth}
        />
        <KpiCard loading={isLoading} label="No-Show Rate" icon={AlertTriangle} color="bg-red-500"
          value={`${noShowRate}%`}
          subValue="Last 90 days"
        />
        {!stats?.financialsRestricted && <KpiCard loading={isLoading} label="Outstanding" icon={Activity} color="bg-orange-500"
          value={formatCurrency(stats?.totals?.outstandingAmount ?? 0)}
        />}
      </div>

      {/* Revenue trend — private; renders only for clinic owners / authorised users */}
      <RevenueTrendCard mode="reports" />

      {/* Appointments + Conversion funnel */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="xl:col-span-3">
          <CardContent className="p-5">
            <SectionHeader title="Appointments" subtitle="Completed vs no-shows" />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trends ?? []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="completed" name="Completed" stackId="a" fill={CHART_COLORS.green}  radius={[0,0,0,0]} />
                <Bar dataKey="noShow"    name="No-Show"   stackId="a" fill={CHART_COLORS.red}    radius={[4,4,0,0]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="p-5">
            <SectionHeader title="Conversion Funnel" subtitle="Last 3 months" />
            <div className="space-y-2 mt-1">
              {(funnel ?? []).map((stage: any, i: number) => {
                const colors = [CHART_COLORS.blue, CHART_COLORS.indigo, CHART_COLORS.purple, CHART_COLORS.green];
                return (
                  <div key={stage.stage}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">{stage.stage}</span>
                      <span className="text-slate-500">{stage.count} · <strong className="text-slate-800">{stage.pct}%</strong></span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="h-2 rounded-full transition-all"
                        style={{ width: `${stage.pct}%`, background: colors[i] }} />
                    </div>
                    {i < (funnel?.length ?? 0) - 1 && (
                      <p className="text-[10px] text-slate-400 text-right mt-0.5">
                        {funnel[i + 1]
                          ? `${funnel[i + 1].pct}% converted`
                          : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dentist performance */}
      <Card>
        <CardContent className="p-5">
          <SectionHeader title="Dentist Performance" subtitle="Last 3 months" />
          {(!dentists || dentists.length === 0) ? (
            <EmptyState title="No data yet" className="py-8" />
          ) : (
            <div className="space-y-4">
              {dentists.map((d: any) => (
                <div key={d.dentistId}>
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700 shrink-0">
                        {d.dentistName?.charAt(0)}
                      </div>
                      <p className="text-sm font-medium text-slate-800 truncate">Dr. {d.dentistName}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
                      <span className="text-emerald-600 font-medium">{d.completed} done</span>
                      {d.noShow > 0 && <span className="text-red-500">{d.noShow} no-show</span>}
                      <span className="font-bold text-slate-700">{d.completionRate}%</span>
                      <span className="text-slate-600">{formatCurrency(d.revenue)}</span>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${d.completionRate}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── REVENUE TAB ────────────────────────────────────────────────────────────────

function RevenueTab() {
  const { data: access, isLoading } = useRevenueAccess();
  if (isLoading) return <Skeleton className="h-64" />;
  if (!access?.canView) return <FinancialsRestricted what="Revenue analytics" />;
  return <RevenueTabContent canManage={access.canManage} />;
}

/** Shown instead of money data to staff without revenue access (the API refuses the data as well). */
function FinancialsRestricted({ what }: { what: string }) {
  return (
    <Card>
      <CardContent className="p-2">
        <EmptyState
          title={`${what} are private`}
          description="Only the clinic owner and staff the owner has authorised can see financial data. Ask your clinic owner for access."
        />
      </CardContent>
    </Card>
  );
}

function RevenueTabContent({ canManage }: { canManage: boolean }) {
  const [months, setMonths] = useState(12);

  const { data: procedures } = useQuery({
    queryKey: ['analytics-procedures', months],
    queryFn:  () => analyticsApi.revenueByProcedure(months),
  });
  const { data: trends } = useQuery({
    queryKey: ['analytics-trends', 'monthly', months],
    queryFn:  () => analyticsApi.trends('monthly', months),
  });
  const { data: yearlyTrends } = useQuery({
    queryKey: ['analytics-trends', 'yearly'],
    queryFn:  () => analyticsApi.trends('yearly', 3),
  });

  const handleExportCsv = useCallback(async () => {
    const blob = await analyticsApi.exportRevenueCsv(months);
    downloadBlob(blob, `revenue-trend-${months}mo.csv`);
  }, [months]);

  const maxRevenue = Math.max(...(procedures ?? []).map((p: any) => p.totalRevenue), 1);

  return (
    <div className="space-y-6">
      {canManage && <RevenueAccessManager />}
      <div className="flex items-center justify-between">
        <PeriodPicker value={months} onChange={setMonths} />
        <button onClick={handleExportCsv}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {/* KPI mini-strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Revenue', value: formatCurrency((trends ?? []).reduce((s: number, t: any) => s + (t.revenue ?? 0), 0)) },
          { label: 'Avg / Month',   value: formatCurrency(trends?.length ? (trends.reduce((s: number, t: any) => s + (t.revenue ?? 0), 0) / trends.length) : 0) },
          { label: 'Top Procedure', value: procedures?.[0]?.procedure?.replace('_', ' ') ?? '—' },
        ].map(item => (
          <div key={item.label} className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="text-lg font-bold text-slate-800 mt-1 capitalize">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Revenue by procedure — horizontal bar */}
      <Card>
        <CardContent className="p-5">
          <SectionHeader title="Revenue per Procedure" subtitle={`Last ${months} months`} />
          {(!procedures || procedures.length === 0) ? (
            <EmptyState title="No completed appointments with invoices yet" className="py-8" />
          ) : (
            <div className="space-y-3">
              {procedures.map((p: any, i: number) => {
                const pct = Math.round((p.totalRevenue / maxRevenue) * 100);
                return (
                  <div key={p.procedure}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="capitalize text-slate-700 font-medium">{p.procedure.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>{p.appointmentCount} appts</span>
                        <span className="text-slate-400">avg {formatCurrency(p.avgRevenue)}</span>
                        <strong className="text-slate-800">{formatCurrency(p.totalRevenue)}</strong>
                      </div>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5">
                      <div className="h-2.5 rounded-full transition-all"
                        style={{ width: `${pct}%`, background: PIE_PALETTE[i % PIE_PALETTE.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly vs Yearly comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <SectionHeader title="Monthly Revenue" />
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trends ?? []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={CHART_COLORS.green} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={CHART_COLORS.green} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} width={44} />
                <Tooltip content={<ChartTip currency />} />
                <Area type="monotone" dataKey="revenue" name="Revenue"
                  stroke={CHART_COLORS.green} strokeWidth={2} fill="url(#revGrad2)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <SectionHeader title="Procedure Mix" subtitle="By revenue" />
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={procedures ?? []} dataKey="totalRevenue" nameKey="procedure"
                  cx="50%" cy="45%" innerRadius={50} outerRadius={75} paddingAngle={3}>
                  {(procedures ?? []).map((_: any, i: number) => (
                    <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any, name: any) => [formatCurrency(Number(v)), name.replace(/_/g,' ')]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }}
                  formatter={(v: string) => v.replace(/_/g, ' ')} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Yearly bar */}
      {yearlyTrends && yearlyTrends.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <SectionHeader title="Year-over-Year Revenue" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={yearlyTrends} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip content={<ChartTip currency />} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.indigo} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── PATIENTS TAB ───────────────────────────────────────────────────────────────

function PatientsTab() {
  const { data: access, isLoading } = useRevenueAccess();
  if (isLoading) return <Skeleton className="h-64" />;
  if (!access?.canView) return <FinancialsRestricted what="Patient lifetime-value analytics" />;
  return <PatientsTabContent />;
}

function PatientsTabContent() {
  const { data: ltv } = useQuery({
    queryKey: ['analytics-ltv'],
    queryFn:  analyticsApi.patientLtv,
  });
  const { data: noShow } = useQuery({
    queryKey: ['analytics-noshow'],
    queryFn:  () => analyticsApi.noShowAnalysis(6),
  });

  const handleExportLtv = useCallback(async () => {
    const blob = await analyticsApi.exportLtvCsv();
    downloadBlob(blob, 'patient-ltv.csv');
  }, []);

  return (
    <div className="space-y-6">
      {/* LTV stats */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Avg Patient LTV</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{formatCurrency(ltv?.avgLtv ?? 0)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Top Patient LTV</p>
          <p className="text-2xl font-bold text-purple-700 mt-1">
            {formatCurrency(ltv?.topPatients?.[0]?.ltv ?? 0)}
          </p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 col-span-2 xl:col-span-1">
          <p className="text-xs text-slate-500">Patients with LTV &gt; ₹15k</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">
            {ltv?.distribution?.filter((b: any) => ['₹15k–30k', '₹30k–60k', '> ₹60k'].includes(b.bucket))
              .reduce((s: number, b: any) => s + b.patientCount, 0) ?? 0}
          </p>
        </div>
      </div>

      {/* LTV distribution + top patients */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <SectionHeader title="LTV Distribution" />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ltv?.distribution ?? []} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} />
                <Bar dataKey="patientCount" name="Patients" fill={CHART_COLORS.purple} radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Top 10 Patients by LTV</h2>
                <p className="text-xs text-slate-400 mt-0.5">Ranked by lifetime spend</p>
              </div>
              <button onClick={handleExportLtv}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 border border-blue-200 px-3 py-1.5 rounded-xl hover:bg-blue-50 transition-colors">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
            <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
              {(ltv?.topPatients ?? []).slice(0, 10).map((p: any, i: number) => (
                <div key={p.patientId} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                  <span className="w-5 text-xs font-bold text-slate-400 shrink-0">{i + 1}</span>
                  <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-700 shrink-0">
                    {p.fullName?.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{p.fullName}</p>
                    <p className="text-xs text-slate-400">{p.visitCount} visits</p>
                  </div>
                  <p className="text-sm font-bold text-purple-700 shrink-0">{formatCurrency(p.ltv)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* No-show analysis */}
      <Card>
        <CardContent className="p-5">
          <SectionHeader title="No-Show Rate Trend" subtitle="Monthly — last 6 months" />
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={noShow?.monthly ?? []} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}%`} width={36} />
              <Tooltip formatter={(v: any) => [`${v}%`, 'No-show rate']} />
              <Line type="monotone" dataKey="rate" name="No-show rate"
                stroke={CHART_COLORS.red} strokeWidth={2} dot={{ r: 4, fill: CHART_COLORS.red }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* No-show by day of week */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <SectionHeader title="No-Shows by Day of Week" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={noShow?.byDow ?? []} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="dayName" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false}
                  tickFormatter={v => `${v}%`} width={32} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'No-show rate']} />
                <Bar dataKey="rate" name="No-show %" fill={CHART_COLORS.amber} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <SectionHeader title="No-Shows by Doctor" />
            {(!noShow?.byDentist || noShow.byDentist.length === 0) ? (
              <EmptyState title="No data yet" className="py-8" />
            ) : (
              <div className="space-y-3 mt-1">
                {noShow.byDentist.map((d: any) => (
                  <div key={d.dentistName}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-700">Dr. {d.dentistName}</span>
                      <span className="text-slate-500">{d.noShows} / {d.total} · <strong className={`${d.rate > 20 ? 'text-red-600' : d.rate > 10 ? 'text-amber-600' : 'text-emerald-600'}`}>{d.rate}%</strong></span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="h-2 rounded-full"
                        style={{ width: `${Math.min(d.rate * 3, 100)}%`, background: d.rate > 20 ? CHART_COLORS.red : d.rate > 10 ? CHART_COLORS.amber : CHART_COLORS.green }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── INSIGHTS TAB ───────────────────────────────────────────────────────────────

function InsightsTab() {
  const [inactiveDays, setInactiveDays] = useState(90);
  const { data: access } = useRevenueAccess();
  const canSeeMoney = !!access?.canView;

  const { data: inactive, isLoading: inactiveLoading } = useQuery({
    queryKey: ['analytics-inactive', inactiveDays],
    queryFn:  () => analyticsApi.inactivePatients(inactiveDays),
  });
  const { data: highValue, isLoading: hvLoading } = useQuery({
    queryKey: ['analytics-highvalue'],
    queryFn:  analyticsApi.highValuePatients,
    enabled:  canSeeMoney,        // the endpoint is 403 for unauthorised staff
    retry:    false,
  });

  const riskBadge = (level: string) => ({
    high:   'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low:    'bg-emerald-100 text-emerald-700',
  }[level] ?? 'bg-slate-100 text-slate-600');

  const tierBadge = (tier: string) => ({
    platinum: 'bg-purple-100 text-purple-700',
    gold:     'bg-amber-100 text-amber-700',
    silver:   'bg-slate-100 text-slate-600',
  }[tier] ?? 'bg-slate-100 text-slate-600');

  const tierIcon = (tier: string) => tier === 'platinum' ? '💎' : tier === 'gold' ? '🥇' : '🥈';

  return (
    <div className="space-y-6">
      {/* Summary flags */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Inactive Patients', value: inactive?.length ?? 0, icon: UserX,  color: 'text-red-600 bg-red-50',     border: 'border-red-100' },
          { label: 'High-Risk (>365d)', value: inactive?.filter((p: any) => p.riskLevel === 'high').length ?? 0, icon: AlertTriangle, color: 'text-orange-600 bg-orange-50', border: 'border-orange-100' },
          ...(canSeeMoney ? [{ label: 'Platinum Patients', value: highValue?.filter((p: any) => p.tier === 'platinum').length ?? 0, icon: Crown, color: 'text-purple-600 bg-purple-50', border: 'border-purple-100' }] : []),
          ...(canSeeMoney ? [{ label: 'Gold Patients',     value: highValue?.filter((p: any) => p.tier === 'gold').length    ?? 0, icon: Star,  color: 'text-amber-600 bg-amber-50',   border: 'border-amber-100' }] : []),
        ].map(item => (
          <div key={item.label} className={`rounded-2xl border ${item.border} p-4 flex items-center gap-3`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${item.color}`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="text-xl font-bold text-slate-800">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Inactive patients */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Inactive Patients</h2>
              <p className="text-xs text-slate-400 mt-0.5">Haven't visited in {inactiveDays}+ days — re-engagement targets</p>
            </div>
            <select value={inactiveDays} onChange={e => setInactiveDays(Number(e.target.value))}
              className="text-xs border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400">
              {[30, 60, 90, 180, 365].map(d => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>

          {inactiveLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !inactive?.length ? (
            <EmptyState title="No inactive patients found — great retention!" className="py-8" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Patient', 'Last Visit', 'Days Inactive', 'Total Visits', ...(canSeeMoney ? ['LTV'] : []), 'Risk'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-400 pb-2 pr-4 last:pr-0">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inactive.map((p: any) => (
                    <tr key={p.patientId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                            {p.fullName?.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800 leading-tight">{p.fullName}</p>
                            {p.phone && <p className="text-xs text-slate-400">{p.phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs">
                        {p.lastVisit ? new Date(p.lastVisit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : 'Never'}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs font-medium">
                        {p.daysInactive != null ? `${p.daysInactive}d` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs">{p.totalVisits}</td>
                      {canSeeMoney && <td className="py-2.5 pr-4 text-slate-700 text-xs font-semibold">{formatCurrency(p.ltv)}</td>}
                      <td className="py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${riskBadge(p.riskLevel)}`}>
                          {p.riskLevel}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* High-value patients — ranked by lifetime spend, so financial: owners / authorised users only */}
      {canSeeMoney && <Card>
        <CardContent className="p-5">
          <SectionHeader
            title="High-Value Patients"
            subtitle="Ranked by lifetime spend — top tier for VIP treatment"
          />
          {hvLoading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !highValue?.length ? (
            <EmptyState title="No billing data yet" className="py-8" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['#', 'Patient', 'Tier', 'LTV', 'Visits', 'Avg Invoice', 'Last Visit', 'Outstanding'].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-slate-400 pb-2 pr-4 last:pr-0 first:w-6">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {highValue.map((p: any, i: number) => (
                    <tr key={p.patientId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 pr-4 text-xs font-bold text-slate-400">{i + 1}</td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-600 shrink-0">
                            {p.fullName?.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800 leading-tight">{p.fullName}</p>
                            {p.phone && <p className="text-xs text-slate-400">{p.phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tierBadge(p.tier)}`}>
                          {tierIcon(p.tier)} {p.tier}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-bold text-purple-700 text-xs">{formatCurrency(p.ltv)}</td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs">{p.visitCount}</td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs">{formatCurrency(p.avgInvoice)}</td>
                      <td className="py-2.5 pr-4 text-slate-600 text-xs">
                        {p.lastVisit ? new Date(p.lastVisit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                      </td>
                      <td className="py-2.5">
                        {p.outstanding > 0 ? (
                          <span className="text-xs font-medium text-red-600">{formatCurrency(p.outstanding)}</span>
                        ) : (
                          <span className="text-xs text-emerald-600">✓ Clear</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>}
    </div>
  );
}

// ── ROOT PAGE ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [activeTab,   setActiveTab]   = useState<Tab>('Overview');
  const [trendCount,  setTrendCount]  = useState(12);
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrintPdf = useCallback(() => {
    window.print();
  }, []);

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body > *:not(#analytics-print) { display: none !important; }
          #analytics-print { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="analytics-print">
        <Header
          title="Reports & Analytics"
          subtitle="Revenue intelligence · Patient LTV · No-show rates · Predictive insights"
          actions={
            <div className="flex gap-2 no-print">
              <PeriodPicker value={trendCount} onChange={setTrendCount} />
              <button onClick={handlePrintPdf}
                className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 bg-white px-3 py-1.5 rounded-xl hover:bg-slate-50 transition-colors text-slate-600 shadow-sm">
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          }
        />

        <div className="page-content">
          {/* Tab bar */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 p-1 rounded-2xl w-fit shadow-sm no-print">
            {TABS.map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                  activeTab === tab
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab === 'Overview'  && <Activity className="w-3.5 h-3.5" />}
                {tab === 'Revenue'   && <DollarSign className="w-3.5 h-3.5" />}
                {tab === 'Patients'  && <Users className="w-3.5 h-3.5" />}
                {tab === 'Insights'  && <Star className="w-3.5 h-3.5" />}
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div ref={printRef}>
            {activeTab === 'Overview' && <OverviewTab trendCount={trendCount} />}
            {activeTab === 'Revenue'  && <RevenueTab />}
            {activeTab === 'Patients' && <PatientsTab />}
            {activeTab === 'Insights' && <InsightsTab />}
          </div>
        </div>
      </div>
    </>
  );
}
