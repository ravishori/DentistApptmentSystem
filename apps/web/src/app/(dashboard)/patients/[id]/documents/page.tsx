'use client';
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { patientsApi } from '@/lib/api';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { DocumentGallery }  from '@/components/documents/DocumentGallery';
import { PatientDocument }  from '@/components/documents/types';

export default function DocumentsPage() {
  const { id: patientId } = useParams<{ id: string }>();

  const [patient,  setPatient]  = useState<any>(null);
  const [total,    setTotal]    = useState(0);
  const [newDocs,  setNewDocs]  = useState<PatientDocument[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    patientsApi.findOne(patientId).then(setPatient).catch(console.error);
  }, [patientId]);

  const handleUploaded = (doc: PatientDocument) => {
    setNewDocs(prev => [doc, ...prev]);
    setTotal(t => t + 1);
    setShowUpload(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/patients" className="hover:text-slate-700">Patients</Link>
        <span>/</span>
        <Link href={`/patients/${patientId}`} className="hover:text-slate-700">
          {patient?.fullName ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">Documents</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {patient?.fullName}
            {total > 0 ? ` · ${total} file${total !== 1 ? 's' : ''}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick links to other patient tabs */}
          <Link
            href={`/patients/${patientId}/ehr`}
            className="px-3 py-2 text-xs text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            EHR Chart
          </Link>
          <Link
            href={`/patients/${patientId}/prescriptions`}
            className="px-3 py-2 text-xs text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50"
          >
            Prescriptions
          </Link>
          <button
            onClick={() => setShowUpload(s => !s)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {showUpload ? 'Cancel' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Storage stats strip */}
      <StorageStrip total={total} />

      {/* Upload panel */}
      {showUpload && (
        <DocumentUploader
          patientId={patientId}
          onUploaded={handleUploaded}
        />
      )}

      {/* Gallery — passes newly uploaded docs as initialDocs so they appear immediately */}
      <DocumentGallery
        patientId={patientId}
        onTotalChange={setTotal}
      />
    </div>
  );
}

// ── Storage strip ──────────────────────────────────────────────────────────────

function StorageStrip({ total }: { total: number }) {
  const types = [
    { label: 'X-Ray',    icon: '🦷', color: 'bg-blue-500'   },
    { label: 'Reports',  icon: '📋', color: 'bg-purple-500' },
    { label: 'Rx',       icon: '💊', color: 'bg-green-500'  },
    { label: 'Lab',      icon: '🔬', color: 'bg-orange-500' },
    { label: 'Photos',   icon: '📸', color: 'bg-pink-500'   },
    { label: 'Other',    icon: '📄', color: 'bg-slate-400'  },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {types.map(t => (
        <div key={t.label} className="bg-white rounded-xl border border-slate-200 px-3 py-3 flex items-center gap-2">
          <span className="text-xl">{t.icon}</span>
          <div>
            <p className="text-xs text-slate-500">{t.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
