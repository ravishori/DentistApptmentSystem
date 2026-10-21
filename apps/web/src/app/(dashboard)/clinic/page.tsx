'use client';
import React, { useState } from 'react';
import { DoctorCalendar } from '@/components/clinic/DoctorCalendar';
import { ChairUtilization } from '@/components/clinic/ChairUtilization';
import { AvailabilitySettings } from '@/components/clinic/AvailabilitySettings';

type Tab = 'calendar' | 'chairs' | 'settings';

export default function ClinicSchedulePage() {
  const [tab, setTab] = useState<Tab>('calendar');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Clinic Schedule</h1>
            <p className="text-sm text-slate-500 mt-0.5">Multi-doctor management, chair allocation & availability</p>
          </div>
          {/* Role badge - shown as UI indicator */}
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Clinic Admin
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 p-1 rounded-2xl w-fit max-w-full overflow-x-auto shadow-sm">
          {([
            { id: 'calendar', label: 'Doctor Calendar', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
            { id: 'chairs',   label: 'Chair Utilization', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
            { id: 'settings', label: 'Availability', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
          ] as { id: Tab; label: string; icon: string }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl transition-colors sm:px-4 ${
                tab === t.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={t.icon} />
              </svg>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'calendar' && <DoctorCalendar />}
        {tab === 'chairs'   && <ChairUtilization />}
        {tab === 'settings' && <AvailabilitySettings />}
      </div>
    </div>
  );
}
