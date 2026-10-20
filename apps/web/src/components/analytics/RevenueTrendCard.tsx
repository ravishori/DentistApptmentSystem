'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { EyeOff, Lock } from 'lucide-react';
import { revenueApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert } from '@/components/ui/alert';

export interface RevenueAccessInfo {
  canView: boolean;
  canManage: boolean;
  showOnDashboard: boolean;
}

/** Capability probe — returns booleans only, so it is safe to call for every staff member. */
export function useRevenueAccess() {
  return useQuery<RevenueAccessInfo>({
    queryKey: ['revenue-access-me'],
    queryFn: revenueApi.me,
    staleTime: 60_000,
    retry: false,
  });
}

const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' });

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone ?? 'text-foreground'}`}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Revenue Trend — a PRIVATE widget. It renders nothing unless the server says the user may view revenue
 * (clinic owner or explicitly authorised), and the data endpoint enforces the same rule independently.
 *  mode="reports"   Reports & Analytics: always shown to authorised users, with the "show on my dashboard" switch.
 *  mode="dashboard" Dashboard: shown only if the user opted in; can be hidden again from here.
 */
export function RevenueTrendCard({ mode, className }: { mode: 'reports' | 'dashboard'; className?: string }) {
  const qc = useQueryClient();
  const { data: access } = useRevenueAccess();
  const [months, setMonths] = useState(6);

  const visible = !!access?.canView && (mode === 'reports' || access.showOnDashboard);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['revenue-trend', months],
    queryFn: () => revenueApi.trend(months),
    enabled: visible,
    retry: false,
  });

  const setPref = useMutation({
    mutationFn: (show: boolean) => revenueApi.setPreference(show),
    onSuccess: (_r, show) => {
      qc.invalidateQueries({ queryKey: ['revenue-access-me'] });
      toast.success(show ? 'Revenue Trend will appear on your dashboard' : 'Revenue Trend hidden from your dashboard');
    },
    onError: () => toast.error('Could not update your dashboard preference'),
  });

  if (!visible) return null;

  const chartData = (data?.months ?? []).map((m: any) => ({ ...m, label: monthLabel(m.period) }));
  const t = data?.totals;
  const o = data?.outstanding;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Revenue Trend
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden="true" /> Private
              </span>
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Collected payments, refunds and unpaid invoices — your clinic only</p>
          </div>

          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor={`rev-months-${mode}`}>Period</label>
            <select
              id={`rev-months-${mode}`}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="h-8 rounded-lg border border-input bg-card px-2 text-xs"
            >
              {[3, 6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}
            </select>

            {mode === 'reports' ? (
              <div className="flex items-center gap-2">
                <Switch
                  id="rev-dashboard-toggle"
                  checked={!!access?.showOnDashboard}
                  disabled={setPref.isPending}
                  onCheckedChange={(v) => setPref.mutate(v)}
                />
                <label htmlFor="rev-dashboard-toggle" className="cursor-pointer text-xs text-muted-foreground">Show on my dashboard</label>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setPref.mutate(false)} loading={setPref.isPending}>
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> Hide
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isError && <Alert variant="warning" title="Revenue data is unavailable">You may no longer have access, or the service is unreachable.</Alert>}

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          !isError && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Collected" value={formatCurrency(t?.collected ?? 0)} hint="Payments received" tone="text-success" />
                <Stat label="Refunded" value={formatCurrency(t?.refunded ?? 0)} hint="Returned to patients" tone="text-destructive" />
                <Stat label="Net" value={formatCurrency(t?.net ?? 0)} hint="Collected − refunded" />
                <Stat
                  label="Outstanding"
                  value={formatCurrency(o?.total ?? 0)}
                  hint={`${o?.openInvoices ?? 0} open invoice${o?.openInvoices === 1 ? '' : 's'} · ${formatCurrency(o?.overdue ?? 0)} overdue`}
                  tone="text-warning"
                />
              </div>

              <div role="img" aria-label={`Monthly collected, refunded and net revenue for the last ${months} months. Net total ${formatCurrency(t?.net ?? 0)}.`}>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} width={48}
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }}
                      formatter={(v: any, name: any) => [formatCurrency(Number(v)), name]}
                    />
                    <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="collected" name="Collected" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="refunded" name="Refunded" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="net" name="Net" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Same numbers for screen readers */}
              <table className="sr-only">
                <caption>Revenue by month</caption>
                <thead><tr><th>Month</th><th>Collected</th><th>Refunded</th><th>Net</th><th>Invoiced</th></tr></thead>
                <tbody>
                  {chartData.map((m: any) => (
                    <tr key={m.period}>
                      <td>{m.period}</td><td>{formatCurrency(m.collected)}</td><td>{formatCurrency(m.refunded)}</td>
                      <td>{formatCurrency(m.net)}</td><td>{formatCurrency(m.invoiced)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
