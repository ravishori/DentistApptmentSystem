'use client';
import React from 'react';
import { prescriptionsApi } from '@/lib/api';

interface Props {
  patientId: string;
  prescription: any;
}

export function PrescriptionPreview({ patientId, prescription: rx }: Props) {
  const pdfUrl = prescriptionsApi.downloadPdfUrl(patientId, rx.id);

  const issued = new Date(rx.issuedAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Rx# {rx.id.slice(-8).toUpperCase()}
            </p>
            <p className="text-xs text-slate-500">{issued} · Dr. {rx.dentist?.fullName}</p>
          </div>
        </div>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
          </svg>
          PDF
        </a>
      </div>

      {/* Medicine list */}
      <div className="divide-y divide-slate-50">
        {rx.items?.map((item: any, i: number) => (
          <div key={i} className="flex items-start gap-3 px-5 py-3">
            <span className="w-5 h-5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">{item.medicineName}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {item.dosage} · {item.frequency} · {item.duration}
                {item.instructions ? ` · ${item.instructions}` : ''}
              </p>
            </div>
            {item.quantity && (
              <span className="text-xs text-slate-400 flex-shrink-0">×{item.quantity}</span>
            )}
          </div>
        ))}
      </div>

      {rx.notes && (
        <div className="px-5 py-3 bg-amber-50 border-t border-amber-100">
          <p className="text-xs text-amber-700 italic">{rx.notes}</p>
        </div>
      )}
    </div>
  );
}
