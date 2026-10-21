'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { prescriptionsApi, patientsApi } from '@/lib/api';
import { PrescriptionBuilder } from '@/components/prescriptions/PrescriptionBuilder';
import { PrescriptionPreview } from '@/components/prescriptions/PrescriptionPreview';
import { Spinner } from '@/components/ui/spinner';

export default function PrescriptionsPage() {
  const { id: patientId } = useParams<{ id: string }>();

  const [patient, setPatient]   = useState<any>(null);
  const [rxList, setRxList]     = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pt, rxData] = await Promise.all([
        patientsApi.findOne(patientId),
        prescriptionsApi.list(patientId, page, 10),
      ]);
      setPatient(pt);
      setRxList(rxData.items ?? []);
      setTotal(rxData.total ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [patientId, page]);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (rx: any) => {
    setShowBuilder(false);
    setRxList(prev => [rx, ...prev]);
    setTotal(t => t + 1);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Spinner className="h-8 w-8 text-primary" label="Loading" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/patients" className="hover:text-slate-700">Patients</Link>
        <span>/</span>
        <Link href={`/patients/${patientId}/ehr`} className="hover:text-slate-700">{patient?.fullName}</Link>
        <span>/</span>
        <Link href={`/patients/${patientId}/ehr`} className="hover:text-slate-700">EHR</Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Prescriptions</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-display text-foreground">Prescriptions</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {patient?.fullName} · {total} prescription{total !== 1 ? 's' : ''}
          </p>
        </div>
        {!showBuilder && (
          <button
            onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Prescription
          </button>
        )}
      </div>

      {/* Builder */}
      {showBuilder && (
        <PrescriptionBuilder
          patientId={patientId}
          onCreated={handleCreated}
          onCancel={() => setShowBuilder(false)}
        />
      )}

      {/* List */}
      {rxList.length === 0 && !showBuilder ? (
        <div className="text-center py-16 text-slate-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
          </svg>
          <p className="font-medium">No prescriptions yet</p>
          <button
            onClick={() => setShowBuilder(true)}
            className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Create first prescription →
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {rxList.map(rx => (
            <PrescriptionPreview key={rx.id} patientId={patientId} prescription={rx} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 10 && (
        <div className="flex justify-center gap-2 pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-slate-50"
          >← Prev</button>
          <span className="px-3 py-1.5 text-sm text-slate-500">
            {page} / {Math.ceil(total / 10)}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 10)}
            className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-40 hover:bg-slate-50"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
