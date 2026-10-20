'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { clinicMgmtApi } from '@/lib/api';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_SLOTS = Array.from({ length: 12 }, (_, i) => `${(i + 8).toString().padStart(2, '0')}:00`); // 08-19

const STATUS_STYLE: Record<string, string> = {
  working:     'bg-green-50 border-green-200',
  leave:       'bg-yellow-50 border-yellow-200',
  holiday:     'bg-orange-50 border-orange-200',
  emergency:   'bg-red-50 border-red-200',
  unavailable: 'bg-slate-50 border-slate-100 opacity-50',
};

const STATUS_BADGE: Record<string, string> = {
  working:     'bg-green-100 text-green-700',
  leave:       'bg-yellow-100 text-yellow-700',
  holiday:     'bg-orange-100 text-orange-700',
  emergency:   'bg-red-100 text-red-700',
  unavailable: 'bg-slate-100 text-slate-400',
};

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function weekStart(date: Date) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return d;
}

interface Props {
  mode?: 'week' | 'day';
}

export function DoctorCalendar({ mode: initMode = 'week' }: Props) {
  const [today]          = useState(() => new Date());
  const [currentDate,    setCurrentDate]    = useState(() => weekStart(new Date()));
  const [mode,           setMode]           = useState<'week' | 'day'>(initMode);
  const [doctors,        setDoctors]        = useState<any[]>([]);
  const [selectedDoc,    setSelectedDoc]    = useState<string>('all');
  const [availData,      setAvailData]      = useState<any[]>([]);
  const [daySchedule,    setDaySchedule]    = useState<any>(null);
  const [loading,        setLoading]        = useState(false);
  const [expandedSlot,   setExpandedSlot]   = useState<string | null>(null);

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentDate, i));
  const fromStr  = weekDays[0].toISOString().split('T')[0];
  const toStr    = weekDays[6].toISOString().split('T')[0];
  const dayStr   = (mode === 'day' ? (currentDate) : today).toISOString().split('T')[0];

  useEffect(() => {
    clinicMgmtApi.getDoctors().then(setDoctors).catch(() => {});
  }, []);

  const loadWeekData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await clinicMgmtApi.checkAvailability({
        from: fromStr,
        to:   toStr,
        ...(selectedDoc !== 'all' && { dentistId: selectedDoc }),
      });
      setAvailData(data);
    } catch {}
    finally { setLoading(false); }
  }, [fromStr, toStr, selectedDoc]);

  const loadDayData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await clinicMgmtApi.getDaySchedule(dayStr);
      setDaySchedule(data);
    } catch {}
    finally { setLoading(false); }
  }, [dayStr]);

  useEffect(() => {
    if (mode === 'week') loadWeekData();
    else                 loadDayData();
  }, [mode, loadWeekData, loadDayData]);

  const prev = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - (mode === 'week' ? 7 : 1));
    setCurrentDate(mode === 'week' ? weekStart(d) : d);
  };
  const next = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + (mode === 'week' ? 7 : 1));
    setCurrentDate(mode === 'week' ? weekStart(d) : d);
  };

  const formatHeader = () => {
    if (mode === 'week') {
      return `${weekDays[0].toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${weekDays[6].toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
    return currentDate.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Doctor filter */}
        <select
          value={selectedDoc}
          onChange={e => setSelectedDoc(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="all">All Doctors</option>
          {doctors.map((d: any) => (
            <option key={d.id} value={d.id}>{d.fullName}</option>
          ))}
        </select>

        {/* Mode toggle */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['week', 'day'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                mode === m ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}>{m}</button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prev}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-slate-700 min-w-[220px] text-center">{formatHeader()}</span>
          <button onClick={next}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button onClick={() => setCurrentDate(weekStart(today))}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-colors">
            Today
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {mode === 'week' && !loading && availData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Header row */}
          <div className="grid border-b border-slate-100" style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}>
            <div className="px-3 py-3 text-xs font-semibold text-slate-500 border-r border-slate-100">Doctor</div>
            {weekDays.map((d, i) => {
              const isToday = d.toISOString().split('T')[0] === today.toISOString().split('T')[0];
              return (
                <div key={i}
                  className={`px-2 py-3 text-center border-r border-slate-100 last:border-0 ${isToday ? 'bg-blue-50' : ''}`}>
                  <p className="text-xs font-medium text-slate-500">{DOW_LABELS[d.getDay()]}</p>
                  <p className={`text-lg font-bold leading-tight ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Doctor rows */}
          {availData.map((row: any) => (
            <div key={row.dentist.id}
              className="grid border-b border-slate-50 last:border-0"
              style={{ gridTemplateColumns: `160px repeat(7, 1fr)` }}>
              {/* Doctor name */}
              <div className="px-3 py-3 border-r border-slate-100 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                  {row.dentist.fullName?.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{row.dentist.fullName}</p>
                </div>
              </div>

              {/* Day cells */}
              {row.schedule.map((day: any, i: number) => (
                <div key={i}
                  className={`px-2 py-2 border-r border-slate-100 last:border-0 min-h-[64px] ${STATUS_STYLE[day.status] ?? ''}`}>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_BADGE[day.status] ?? ''}`}>
                    {day.status}
                  </span>
                  {day.status === 'working' && day.slots.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {day.slots.filter((s: any) => s.isBooked).slice(0, 3).map((s: any) => (
                        <div key={s.id}
                          className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded truncate cursor-pointer hover:bg-blue-200 transition-colors"
                          onClick={() => setExpandedSlot(expandedSlot === s.id ? null : s.id)}
                          title={s.patient?.fullName}
                        >
                          {s.startTime} {s.patient?.fullName?.split(' ')[0] ?? '—'}
                        </div>
                      ))}
                      {day.slots.filter((s: any) => s.isBooked).length > 3 && (
                        <div className="text-[10px] text-slate-400">
                          +{day.slots.filter((s: any) => s.isBooked).length - 3} more
                        </div>
                      )}
                      <div className="text-[10px] text-green-600 font-medium">
                        {day.slots.filter((s: any) => !s.isBooked).length} free
                      </div>
                    </div>
                  )}
                  {day.status === 'working' && day.slots.length === 0 && day.workStart && (
                    <div className="text-[10px] text-slate-400 mt-1">
                      {day.workStart}–{day.workEnd}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {mode === 'day' && !loading && daySchedule && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Total Appointments</p>
              <p className="text-2xl font-bold text-slate-800">{daySchedule.totalAppointments}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Doctors Working</p>
              <p className="text-2xl font-bold text-slate-800">{daySchedule.byDentist?.length ?? 0}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">Chairs Used</p>
              <p className="text-2xl font-bold text-slate-800">
                {daySchedule.byChair?.filter((c: any) => c.appointments.length > 0).length ?? 0}
                /{daySchedule.byChair?.length ?? 0}
              </p>
            </div>
          </div>

          {/* By dentist */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">By Doctor</h3>
            </div>
            {daySchedule.byDentist?.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-10">No appointments today</p>
            )}
            {daySchedule.byDentist?.map((row: any) => (
              <div key={row.dentist.id} className="border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3 px-5 py-3 bg-slate-50">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
                    {row.dentist.fullName?.charAt(0)}
                  </div>
                  <p className="font-medium text-slate-800">{row.dentist.fullName}</p>
                  <span className="ml-auto text-xs text-slate-500">{row.appointments.length} appointments</span>
                </div>
                <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {row.appointments.map((appt: any) => (
                    <div key={appt.id} className="bg-blue-50 rounded-xl px-3 py-2 border border-blue-100">
                      <p className="text-xs font-semibold text-blue-700">{appt.startTime}–{appt.endTime}</p>
                      <p className="text-xs text-slate-700 font-medium truncate">{appt.patient?.fullName}</p>
                      {appt.chair && (
                        <p className="text-[10px] text-slate-400">{appt.chair.name}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && availData.length === 0 && mode === 'week' && (
        <div className="text-center py-16 text-slate-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="font-medium">No availability data for this week</p>
          <p className="text-sm mt-1">Set up doctor availability rules first</p>
        </div>
      )}
    </div>
  );
}
