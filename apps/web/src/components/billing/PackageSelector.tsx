'use client';
import React, { useState, useEffect } from 'react';
import { packagesApi, patientsApi } from '@/lib/api';

interface Props {
  patientId?:  string;
  onEnrolled?: (enrollment: any) => void;
}

export function PackageSelector({ patientId: initialPatientId, onEnrolled }: Props) {
  const [packages,     setPackages]     = useState<any[]>([]);
  const [patientId,    setPatientId]    = useState(initialPatientId ?? '');
  const [patientSearch, setPatientSearch] = useState('');
  const [patients,     setPatients]     = useState<any[]>([]);
  const [selectedPat,  setSelectedPat]  = useState<any>(null);
  const [packageId,    setPackageId]    = useState('');
  const [installments, setInstallments] = useState(1);
  const [startDate,    setStartDate]    = useState('');
  const [notes,        setNotes]        = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  const selectedPkg = packages.find((p: any) => p.id === packageId);

  useEffect(() => {
    packagesApi.list().then(setPackages).catch(() => {});
  }, []);

  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return; }
    const t = setTimeout(async () => {
      const res = await patientsApi.list({ q: patientSearch, limit: 8 });
      setPatients(res.items ?? res ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [patientSearch]);

  const schedule = React.useMemo(() => {
    if (!selectedPkg || installments < 2) return [];
    const total = Number(selectedPkg.totalPrice);
    const per   = Math.round((total / installments) * 100) / 100;
    const start = startDate ? new Date(startDate) : new Date();
    return Array.from({ length: installments }, (_, i) => {
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      return {
        installmentNo: i + 1,
        amount: i === installments - 1
          ? Math.round((total - per * (installments - 1)) * 100) / 100
          : per,
        dueDate: due.toISOString().split('T')[0],
      };
    });
  }, [selectedPkg, installments, startDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pid = patientId || selectedPat?.id;
    if (!pid)        { setError('Select a patient'); return; }
    if (!packageId)  { setError('Select a package'); return; }
    setError('');
    setSubmitting(true);
    try {
      const enrollment = await packagesApi.enroll({
        patientId:    pid,
        packageId,
        installments: installments > 1 ? installments : undefined,
        startDate:    startDate || undefined,
        notes:        notes || undefined,
      });
      setSuccess(`Enrolled in "${selectedPkg?.name}" successfully!`);
      onEnrolled?.(enrollment);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-slate-800">{success}</p>
        <button onClick={() => setSuccess('')}
          className="mt-4 text-sm text-blue-600 hover:underline">Enroll another patient</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Patient selector (only shown if no patientId prop) */}
      {!initialPatientId && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Patient</h3>
          {selectedPat ? (
            <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3">
              <div>
                <p className="font-medium text-slate-800">{selectedPat.fullName}</p>
                <p className="text-xs text-slate-500">{selectedPat.phone}</p>
              </div>
              <button type="button" onClick={() => { setSelectedPat(null); setPatientId(''); }}
                className="text-xs text-blue-600 hover:underline">Change</button>
            </div>
          ) : (
            <div className="relative">
              <input
                value={patientSearch} onChange={e => setPatientSearch(e.target.value)}
                placeholder="Search patient…"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              {patients.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                  {patients.map((p: any) => (
                    <button key={p.id} type="button"
                      onClick={() => { setSelectedPat(p); setPatientId(p.id); setPatients([]); setPatientSearch(''); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-sm"
                    >
                      {p.fullName} <span className="text-xs text-slate-400">{p.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Package grid */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Select Package</p>
        {packages.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8 bg-white rounded-2xl border border-slate-200">
            No active packages. Create one first.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {packages.map((pkg: any) => (
              <button
                key={pkg.id} type="button"
                onClick={() => setPackageId(pkg.id === packageId ? '' : pkg.id)}
                className={`text-left p-4 rounded-2xl border-2 transition-all ${
                  packageId === pkg.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-white hover:border-blue-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <p className="font-medium text-slate-800">{pkg.name}</p>
                  {packageId === pkg.id && (
                    <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
                {pkg.description && (
                  <p className="text-xs text-slate-500 mt-1">{pkg.description}</p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    {pkg.totalVisits} visits
                  </span>
                  <span className="font-semibold text-blue-700">
                    ₹{Number(pkg.totalPrice).toLocaleString('en-IN')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Installment options */}
      {selectedPkg && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Payment Plan</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500">Number of Installments</label>
              <select
                value={installments} onChange={e => setInstallments(Number(e.target.value))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {[1,2,3,4,6,12].map(n => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Single payment' : `${n} installments`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">Start Date</label>
              <input
                type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Preview schedule */}
          {schedule.length > 0 && (
            <div className="border border-slate-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-500">#</th>
                    <th className="px-3 py-2 text-left font-medium text-slate-500">Due Date</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-500">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schedule.map(row => (
                    <tr key={row.installmentNo}>
                      <td className="px-3 py-2 text-slate-600">{row.installmentNo}</td>
                      <td className="px-3 py-2 text-slate-600">{row.dueDate}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        ₹{row.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>
        </div>
      )}

      <button
        type="submit" disabled={submitting || !packageId || (!initialPatientId && !selectedPat)}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Enrolling…' : 'Enroll Patient'}
      </button>
    </form>
  );
}
