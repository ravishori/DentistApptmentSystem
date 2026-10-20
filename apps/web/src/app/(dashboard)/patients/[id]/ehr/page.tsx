'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ehrApi, patientsApi } from '@/lib/api';
import { DentalChart } from '@/components/dental-chart/DentalChart';
import { DentalChart as ChartType } from '@/components/dental-chart/types';
import { Spinner } from '@/components/ui/spinner';

export default function EhrPage() {
  const { id: patientId } = useParams<{ id: string }>();

  const [patient, setPatient]     = useState<any>(null);
  const [chart, setChart]         = useState<ChartType | null>(null);
  const [timeline, setTimeline]   = useState<any[]>([]);
  const [page, setPage]           = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]     = useState(true);
  const [activeTab, setActiveTab] = useState<'chart' | 'timeline'>('chart');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pt, ch, tl] = await Promise.all([
        patientsApi.findOne(patientId),
        ehrApi.getChart(patientId),
        ehrApi.getTimeline(patientId, page, 10),
      ]);
      setPatient(pt);
      setChart(ch);
      setTimeline(tl.items);
      setTotalPages(tl.pages ?? 1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [patientId, page]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spinner className="h-8 w-8 text-primary" label="Loading" />
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/patients" className="hover:text-slate-700">Patients</Link>
        <span>/</span>
        <Link href={`/patients/${patientId}/ehr`} className="hover:text-slate-700">{patient?.fullName}</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">EHR</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{patient?.fullName}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {patient?.age ? `${patient.age} yrs · ` : ''}
            {patient?.gender ? `${patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)} · ` : ''}
            {patient?.patientCode}
          </p>
        </div>
        <Link
          href={`/patients/${patientId}/prescriptions`}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
          </svg>
          Prescriptions
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {(['chart', 'timeline'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all capitalize ${
              activeTab === tab
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab === 'chart' ? 'Dental Chart' : 'Visit Timeline'}
          </button>
        ))}
      </div>

      {/* Dental Chart tab */}
      {activeTab === 'chart' && chart && (
        <DentalChart
          patientId={patientId}
          chart={chart}
          onChartUpdated={setChart}
        />
      )}

      {/* Timeline tab */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {timeline.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="font-medium">No visits recorded yet</p>
            </div>
          ) : (
            timeline.map((visit, i) => <VisitCard key={visit.id} visit={visit} isFirst={i === 0} />)
          )}

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >← Prev</button>
              <span className="px-3 py-1.5 text-sm text-slate-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-slate-50"
              >Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VisitCard({ visit, isFirst }: { visit: any; isFirst: boolean }) {
  const [expanded, setExpanded] = useState(isFirst);

  const date = new Date(visit.visitDate).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-800">{date}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Dr. {visit.dentist?.fullName}
              {visit.chiefComplaint ? ` · ${visit.chiefComplaint}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {visit.diagnoses?.length > 0 && (
            <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">
              {visit.diagnoses.length} Dx
            </span>
          )}
          {visit.prescriptions?.length > 0 && (
            <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full font-medium">
              {visit.prescriptions.length} Rx
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-4">
          {/* Clinical notes */}
          {visit.clinicalNotes && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Clinical Notes</p>
              <p className="text-sm text-slate-700">{visit.clinicalNotes}</p>
            </div>
          )}

          {/* Diagnoses */}
          {visit.diagnoses?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Diagnoses</p>
              <div className="space-y-1.5">
                {visit.diagnoses.map((d: any) => (
                  <div key={d.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-slate-700">{d.description}</span>
                    {d.toothFdi && (
                      <span className="text-xs text-slate-400">(Tooth {d.toothFdi})</span>
                    )}
                    {d.severity && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                        d.severity === 'severe' ? 'bg-red-100 text-red-700' :
                        d.severity === 'moderate' ? 'bg-orange-100 text-orange-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{d.severity}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prescriptions */}
          {visit.prescriptions?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Prescriptions</p>
              <div className="space-y-1">
                {visit.prescriptions.map((rx: any) => (
                  <div key={rx.id} className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2">
                    <span className="text-slate-700">
                      {rx.items?.length} medicine{rx.items?.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-slate-400">
                      Rx# {rx.id.slice(-8).toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vitals */}
          {visit.vitalSigns && Object.keys(visit.vitalSigns).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Vitals</p>
              <div className="flex flex-wrap gap-3">
                {visit.vitalSigns.bloodPressureSystolic && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-lg">
                    BP {visit.vitalSigns.bloodPressureSystolic}/{visit.vitalSigns.bloodPressureDiastolic}
                  </span>
                )}
                {visit.vitalSigns.pulse && (
                  <span className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded-lg">
                    Pulse {visit.vitalSigns.pulse} bpm
                  </span>
                )}
                {visit.vitalSigns.temperature && (
                  <span className="text-xs bg-orange-50 text-orange-700 px-2 py-1 rounded-lg">
                    Temp {visit.vitalSigns.temperature}°C
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
