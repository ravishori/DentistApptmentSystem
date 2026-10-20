'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { reportsApi } from '@/lib/api';
import { Spinner } from '@/components/ui/spinner';

// ── tiny chart helper (no external dep) ───────────────────────────────────────
function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
          <div
            className="w-full bg-blue-500 rounded-t-sm transition-all duration-300 hover:bg-blue-600 cursor-pointer"
            style={{ height: `${(d.value / max) * 100}%`, minHeight: '2px' }}
          />
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-foreground text-background text-xs rounded-md px-2 py-1 whitespace-nowrap z-10">
            {d.label}: ₹{d.value.toLocaleString('en-IN')}
          </div>
        </div>
      ))}
    </div>
  );
}

const AGING_COLORS: Record<string, string> = {
  '0-30':  'bg-yellow-400',
  '31-60': 'bg-orange-500',
  '61-90': 'bg-red-500',
  '90+':   'bg-red-800',
};

export function ReportsDashboard() {
  const today    = new Date();
  const defFrom  = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const defTo    = today.toISOString().split('T')[0];

  const [tab,        setTab]        = useState<'revenue' | 'outstanding' | 'gst'>('revenue');
  const [from,       setFrom]       = useState(defFrom);
  const [to,         setTo]         = useState(defTo);
  const [revenue,    setRevenue]    = useState<any>(null);
  const [outstanding,setOutstanding]= useState<any>(null);
  const [gst,        setGst]        = useState<any>(null);
  const [loading,    setLoading]    = useState(false);

  const loadRevenue = useCallback(async () => {
    setLoading(true);
    try { setRevenue(await reportsApi.dailyRevenue(from, to)); } catch {}
    finally { setLoading(false); }
  }, [from, to]);

  const loadOutstanding = useCallback(async () => {
    setLoading(true);
    try { setOutstanding(await reportsApi.outstanding()); } catch {}
    finally { setLoading(false); }
  }, []);

  const loadGst = useCallback(async () => {
    setLoading(true);
    try { setGst(await reportsApi.gst(from, to)); } catch {}
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => {
    if (tab === 'revenue')     loadRevenue();
    if (tab === 'outstanding') loadOutstanding();
    if (tab === 'gst')         loadGst();
  }, [tab, loadRevenue, loadOutstanding, loadGst]);

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['revenue', 'outstanding', 'gst'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}>
            {t === 'revenue' ? 'Daily Revenue' : t === 'outstanding' ? 'Outstanding' : 'GST Report'}
          </button>
        ))}
      </div>

      {/* Date range (for revenue + gst) */}
      {(tab === 'revenue' || tab === 'gst') && (
        <div className="flex items-center gap-3">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button
            onClick={tab === 'revenue' ? loadRevenue : loadGst}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={() => reportsApi.downloadCsv(
              tab === 'revenue' ? 'daily-revenue' : 'gst',
              { from, to },
            )}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            CSV
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Spinner className="h-8 w-8 text-primary" label="Loading" />
        </div>
      )}

      {/* ── REVENUE ── */}
      {tab === 'revenue' && !loading && revenue && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <StatCard label="Total Revenue" value={fmt(revenue.total ?? 0)} accent="blue" />
            <StatCard label="Days" value={String(revenue.rows?.length ?? 0)} accent="slate" />
            <StatCard label="Avg / Day"
              value={fmt(revenue.rows?.length ? (revenue.total / revenue.rows.length) : 0)} accent="green" />
          </div>

          {revenue.rows?.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 mb-4">Daily Revenue Chart</p>
              <BarChart data={revenue.rows.slice(-30).map((r: any) => ({
                label: r.date,
                value: r.revenue,
              }))} />
              <div className="flex gap-1 mt-2 overflow-x-auto pb-1">
                {revenue.rows.slice(-30).map((r: any, i: number) => (
                  <div key={i} className="flex-1 text-center text-[9px] text-slate-400 min-w-[14px]">
                    {i % 5 === 0 ? r.date.slice(8) : ''}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Revenue</th>
                  <th className="px-4 py-3 text-right font-medium">Invoices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {revenue.rows?.map((r: any) => (
                  <tr key={r.date} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{r.date}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">{fmt(r.revenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{r.invoices}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── OUTSTANDING ── */}
      {tab === 'outstanding' && !loading && outstanding && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Outstanding" value={fmt(outstanding.summary?.total ?? 0)} accent="red" />
            <StatCard label="0–30 days" value={fmt(outstanding.summary?.bucket_0_30 ?? 0)} accent="yellow" />
            <StatCard label="31–60 days" value={fmt(outstanding.summary?.bucket_31_60 ?? 0)} accent="orange" />
            <StatCard label="90+ days" value={fmt(outstanding.summary?.bucket_90p ?? 0)} accent="red" />
          </div>

          {/* Aging bar */}
          {outstanding.summary?.total > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p className="text-xs font-medium text-slate-500 mb-3">Aging Distribution</p>
              <div className="flex h-4 rounded-full overflow-hidden gap-px">
                {(['0-30', '31-60', '61-90', '90+'] as const).map(b => {
                  const val = outstanding.summary?.[`bucket_${b.replace('-','_').replace('+','p')}`] ?? 0;
                  const pct = (val / outstanding.summary.total) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div key={b} className={`${AGING_COLORS[b]} transition-all`} style={{ width: `${pct}%` }}
                      title={`${b} days: ${fmt(val)}`} />
                  );
                })}
              </div>
              <div className="flex gap-4 mt-2">
                {Object.entries(AGING_COLORS).map(([b, cls]) => (
                  <div key={b} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <div className={`w-3 h-3 rounded-sm ${cls}`} />
                    {b} days
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={() => reportsApi.downloadCsv('outstanding', {})}
              className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-xl hover:bg-slate-50 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Invoice</th>
                  <th className="px-4 py-3 text-left font-medium">Patient</th>
                  <th className="px-4 py-3 text-left font-medium">Due Date</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                  <th className="px-4 py-3 text-center font-medium">Aging</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {outstanding.rows?.map((r: any) => (
                  <tr key={r.invoiceId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{r.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{r.patientName}</p>
                      {r.phone && <p className="text-xs text-slate-400">{r.phone}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.dueDate ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(r.totalAmount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">{fmt(r.balance)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full text-white ${AGING_COLORS[r.agingBucket]}`}>
                        {r.agingBucket}
                      </span>
                    </td>
                  </tr>
                ))}
                {outstanding.rows?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">No outstanding dues</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── GST ── */}
      {tab === 'gst' && !loading && gst && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Taxable Base" value={fmt(gst.summary?.taxableBase ?? 0)} accent="slate" />
            <StatCard label="CGST" value={fmt(gst.summary?.cgst ?? 0)} accent="blue" />
            <StatCard label="SGST" value={fmt(gst.summary?.sgst ?? 0)} accent="blue" />
            <StatCard label="Total Tax" value={fmt(gst.summary?.totalTax ?? 0)} accent="purple" />
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Month</th>
                  <th className="px-4 py-3 text-right font-medium">Taxable</th>
                  <th className="px-4 py-3 text-right font-medium">CGST</th>
                  <th className="px-4 py-3 text-right font-medium">SGST</th>
                  <th className="px-4 py-3 text-right font-medium">IGST</th>
                  <th className="px-4 py-3 text-right font-medium">Total Tax</th>
                  <th className="px-4 py-3 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {gst.rows?.map((r: any) => (
                  <tr key={r.month} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-700">{r.month}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(r.taxableBase)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(r.cgst)}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(r.sgst)}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{fmt(r.igst)}</td>
                    <td className="px-4 py-3 text-right font-medium text-blue-700">{fmt(r.totalTax)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(r.totalRevenue)}</td>
                  </tr>
                ))}
                {gst.rows?.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">No invoices in this period</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-50 border-blue-100',
    green:  'bg-green-50 border-green-100',
    red:    'bg-red-50 border-red-100',
    yellow: 'bg-yellow-50 border-yellow-100',
    orange: 'bg-orange-50 border-orange-100',
    purple: 'bg-purple-50 border-purple-100',
    slate:  'bg-slate-50 border-slate-200',
  };
  return (
    <div className={`rounded-2xl border p-4 ${colors[accent] ?? colors.slate}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-bold text-slate-800 truncate">{value}</p>
    </div>
  );
}
