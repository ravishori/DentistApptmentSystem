'use client';
import React, { useState, useEffect } from 'react';
import { clinicMgmtApi } from '@/lib/api';
import { Spinner } from '@/components/ui/spinner';

// ── Time grid constants ────────────────────────────────────────────────────────
const DAY_START  = 8 * 60;  // 08:00 in minutes
const DAY_END    = 20 * 60; // 20:00 in minutes
const TOTAL_MINS = DAY_END - DAY_START;
const HOURS      = Array.from({ length: 13 }, (_, i) => i + 8); // 8..20

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function pct(mins: number) {
  return Math.max(0, Math.min(100, ((mins - DAY_START) / TOTAL_MINS) * 100));
}

function widthPct(start: string, end: string) {
  return Math.max(1, pct(timeToMins(end)) - pct(timeToMins(start)));
}

const APPT_COLORS = [
  'bg-blue-400', 'bg-indigo-400', 'bg-violet-400', 'bg-purple-400',
  'bg-pink-400',  'bg-teal-400',  'bg-cyan-400',   'bg-sky-400',
];

interface Props {
  date?: string;
}

export function ChairUtilization({ date: initDate }: Props) {
  const today = new Date().toISOString().split('T')[0];
  const [date,         setDate]         = useState(initDate ?? today);
  const [utilization,  setUtilization]  = useState<any[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [tooltip,      setTooltip]      = useState<any>(null);
  const [showAddChair, setShowAddChair] = useState(false);
  const [newChairName, setNewChairName] = useState('');
  const [newChairNo,   setNewChairNo]   = useState('');
  const [addingChair,  setAddingChair]  = useState(false);

  const load = async (d: string) => {
    setLoading(true);
    try { setUtilization(await clinicMgmtApi.chairUtilization(d)); } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(date); }, [date]);

  const handleAddChair = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingChair(true);
    try {
      await clinicMgmtApi.createChair({ name: newChairName, chairNumber: Number(newChairNo) });
      setShowAddChair(false);
      setNewChairName(''); setNewChairNo('');
      load(date);
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Failed to add chair');
    } finally {
      setAddingChair(false);
    }
  };

  const totalAppts = utilization.reduce((s, c) => s + c.utilization, 0);
  const busyChairs = utilization.filter(c => c.utilization > 0).length;

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <button onClick={() => setDate(today)}
          className="px-3 py-2 text-sm font-medium border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors">
          Today
        </button>
        <button onClick={() => setShowAddChair(!showAddChair)}
          className="ml-auto px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Chair
        </button>
      </div>

      {/* Add chair form */}
      {showAddChair && (
        <form onSubmit={handleAddChair}
          className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-600">Chair Name</label>
            <input value={newChairName} onChange={e => setNewChairName(e.target.value)} required
              placeholder="e.g. Chair 3"
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="w-28">
            <label className="text-xs font-medium text-slate-600">Chair No.</label>
            <input type="number" min="1" max="99" value={newChairNo} onChange={e => setNewChairNo(e.target.value)} required
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button type="submit" disabled={addingChair}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
            {addingChair ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={() => setShowAddChair(false)}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 bg-white rounded-xl hover:bg-slate-50 transition-colors">
            Cancel
          </button>
        </form>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total Chairs</p>
          <p className="text-2xl font-bold text-slate-800">{utilization.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Busy Chairs</p>
          <p className="text-2xl font-bold text-blue-700">{busyChairs}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs text-slate-500">Total Appointments</p>
          <p className="text-2xl font-bold text-slate-800">{totalAppts}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner className="h-8 w-8 text-primary" label="Loading" />
        </div>
      ) : utilization.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <p className="font-medium">No chairs configured</p>
          <p className="text-sm mt-1">Add dental chairs using the button above</p>
        </div>
      ) : (
        /* Gantt chart */
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Chair Timeline — {date}</h3>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Hour header */}
              <div className="flex border-b border-slate-100">
                <div className="w-32 flex-shrink-0 px-4 py-2 text-xs font-medium text-slate-500">Chair</div>
                <div className="flex-1 relative h-8 pr-4">
                  <div className="flex justify-between text-xs text-slate-400">
                    {HOURS.map(h => (
                      <span key={h} className="w-8 text-center">{h}:00</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chair rows */}
              {utilization.map((row: any, rowIdx: number) => (
                <div key={row.chair.id} className={`flex items-center border-b border-slate-50 last:border-0 ${rowIdx % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                  {/* Chair label */}
                  <div className="w-32 flex-shrink-0 px-4 py-3 flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: row.chair.color ?? '#3B82F6' }}
                    />
                    <div>
                      <p className="text-xs font-semibold text-slate-700">{row.chair.name}</p>
                      <p className="text-[10px] text-slate-400">{row.utilization} appts</p>
                    </div>
                  </div>

                  {/* Timeline bar */}
                  <div className="flex-1 relative h-12 pr-4 py-2">
                    {/* Grid lines */}
                    <div className="absolute inset-0 flex pr-4">
                      {HOURS.map((_, i) => (
                        <div key={i} className="flex-1 border-l border-slate-100 first:border-0" />
                      ))}
                    </div>

                    {/* Appointment blocks */}
                    {row.appointments.map((appt: any, ai: number) => {
                      const left  = pct(timeToMins(appt.startTime));
                      const width = widthPct(appt.startTime, appt.endTime);
                      const colorClass = APPT_COLORS[ai % APPT_COLORS.length];
                      return (
                        <div
                          key={appt.id}
                          className={`absolute top-1.5 bottom-1.5 rounded-md ${colorClass} cursor-pointer hover:brightness-90 transition-all flex items-center px-1.5 overflow-hidden z-10`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          onMouseEnter={(e) => setTooltip({
                            x: e.clientX, y: e.clientY,
                            appt,
                          })}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <span className="text-white text-[10px] font-medium truncate">
                            {appt.startTime} {appt.patient?.fullName?.split(' ')[0] ?? ''}
                          </span>
                        </div>
                      );
                    })}

                    {row.utilization === 0 && (
                      <div className="absolute inset-0 flex items-center pl-2">
                        <span className="text-xs text-slate-300">— free —</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-foreground text-background text-xs rounded-xl shadow-xl px-3 py-2.5 pointer-events-none"
          style={{ top: tooltip.y - 80, left: tooltip.x + 12 }}
        >
          <p className="font-semibold">{tooltip.appt.patient?.fullName}</p>
          <p className="text-slate-300">{tooltip.appt.startTime} – {tooltip.appt.endTime}</p>
          <p className="text-slate-300">Dr. {tooltip.appt.dentist?.fullName}</p>
          <p className="capitalize text-slate-400">{tooltip.appt.type?.replace('_', ' ')}</p>
        </div>
      )}
    </div>
  );
}
