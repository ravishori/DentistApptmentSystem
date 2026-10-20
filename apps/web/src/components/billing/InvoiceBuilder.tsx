'use client';
import React, { useState, useEffect } from 'react';
import { billingApi, patientsApi, packagesApi } from '@/lib/api';

interface LineItem {
  description:     string;
  toothNumber:     string;
  quantity:        number;
  unitPrice:       number;
  discountPercent: number;
}

interface Props {
  onCreated?: (invoice: any) => void;
}

export function InvoiceBuilder({ onCreated }: Props) {
  const [patientSearch, setPatientSearch]   = useState('');
  const [patients,      setPatients]        = useState<any[]>([]);
  const [selectedPat,   setSelectedPat]     = useState<any>(null);
  const [packages,      setPackages]        = useState<any[]>([]);
  const [packageId,     setPackageId]       = useState('');
  const [items,         setItems]           = useState<LineItem[]>([emptyLine()]);
  const [discountPct,   setDiscountPct]     = useState(0);
  const [taxPct,        setTaxPct]          = useState(18);
  const [dueDate,       setDueDate]         = useState('');
  const [notes,         setNotes]           = useState('');
  const [appointmentId, setAppointmentId]   = useState('');
  const [submitting,    setSubmitting]      = useState(false);
  const [error,         setError]           = useState('');

  function emptyLine(): LineItem {
    return { description: '', toothNumber: '', quantity: 1, unitPrice: 0, discountPercent: 0 };
  }

  // Patient search
  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return; }
    const t = setTimeout(async () => {
      const res = await patientsApi.list({ q: patientSearch, limit: 10 });
      setPatients(res.items ?? res ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [patientSearch]);

  // Load packages for selector
  useEffect(() => {
    packagesApi.list().then(setPackages).catch(() => {});
  }, []);

  // When package selected, pre-fill line items
  useEffect(() => {
    if (!packageId) return;
    const pkg = packages.find((p: any) => p.id === packageId);
    if (!pkg) return;
    const pkgItems: LineItem[] = pkg.items.map((it: any) => ({
      description:     it.description,
      toothNumber:     '',
      quantity:        it.quantity,
      unitPrice:       Number(it.unitPrice),
      discountPercent: 0,
    }));
    setItems(pkgItems.length ? pkgItems : [emptyLine()]);
    setTaxPct(Number(pkg.taxPercent ?? 18));
  }, [packageId, packages]);

  const addLine = () => setItems(prev => [...prev, emptyLine()]);
  const removeLine = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof LineItem, val: string | number) => {
    setItems(prev => prev.map((it, idx) =>
      idx === i ? { ...it, [field]: val } : it,
    ));
  };

  // Calculations
  const subtotal = items.reduce((s, it) => {
    const lineTotal = it.quantity * it.unitPrice * (1 - it.discountPercent / 100);
    return s + lineTotal;
  }, 0);
  const discountAmount = subtotal * discountPct / 100;
  const taxable        = subtotal - discountAmount;
  const taxAmount      = taxable * taxPct / 100;
  const cgst           = taxAmount / 2;
  const sgst           = taxAmount - cgst;
  const total          = taxable + taxAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPat) { setError('Select a patient first'); return; }
    if (items.some(it => !it.description || it.unitPrice <= 0)) {
      setError('All line items need a description and price'); return;
    }
    setError('');
    setSubmitting(true);
    try {
      const invoice = await billingApi.createInvoice({
        patientId:       selectedPat.id,
        appointmentId:   appointmentId || undefined,
        items:           items.map(it => ({
          description:     it.description,
          toothNumber:     it.toothNumber || undefined,
          quantity:        it.quantity,
          unitPrice:       it.unitPrice,
          discountPercent: it.discountPercent,
        })),
        discountPercent: discountPct,
        taxPercent:      taxPct,
        dueDate:         dueDate || undefined,
        notes:           notes || undefined,
      });
      onCreated?.(invoice);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to create invoice');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {/* Patient */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Patient</h3>
        {selectedPat ? (
          <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3">
            <div>
              <p className="font-medium text-slate-800">{selectedPat.fullName}</p>
              <p className="text-xs text-slate-500">{selectedPat.phone} · {selectedPat.patientCode}</p>
            </div>
            <button type="button" onClick={() => setSelectedPat(null)}
              className="text-xs text-blue-600 hover:underline">Change</button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={patientSearch}
              onChange={e => setPatientSearch(e.target.value)}
              placeholder="Search patient by name or phone…"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {patients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                {patients.map((p: any) => (
                  <button key={p.id} type="button"
                    onClick={() => { setSelectedPat(p); setPatients([]); setPatientSearch(''); }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                  >
                    <span className="font-medium text-sm">{p.fullName}</span>
                    <span className="ml-2 text-xs text-slate-400">{p.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Package selector */}
      {packages.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Apply Package (optional)</h3>
          <select
            value={packageId}
            onChange={e => setPackageId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">— No package —</option>
            {packages.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} — ₹{Number(p.totalPrice).toLocaleString('en-IN')} ({p.totalVisits} visits)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Line items */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Line Items</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium w-1/3">Description</th>
                <th className="pb-2 font-medium">Tooth</th>
                <th className="pb-2 font-medium">Qty</th>
                <th className="pb-2 font-medium">Rate (₹)</th>
                <th className="pb-2 font-medium">Disc%</th>
                <th className="pb-2 font-medium text-right">Amount</th>
                <th className="pb-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((it, i) => {
                const lineAmt = it.quantity * it.unitPrice * (1 - it.discountPercent / 100);
                return (
                  <tr key={i}>
                    <td className="py-1.5 pr-2">
                      <input
                        value={it.description}
                        onChange={e => updateLine(i, 'description', e.target.value)}
                        placeholder="Procedure / treatment"
                        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        value={it.toothNumber}
                        onChange={e => updateLine(i, 'toothNumber', e.target.value)}
                        placeholder="e.g. 21"
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" min="1" value={it.quantity}
                        onChange={e => updateLine(i, 'quantity', Number(e.target.value))}
                        className="w-14 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" min="0" step="0.01" value={it.unitPrice || ''}
                        onChange={e => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number" min="0" max="100" step="1" value={it.discountPercent || ''}
                        onChange={e => updateLine(i, 'discountPercent', parseFloat(e.target.value) || 0)}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>
                    <td className="py-1.5 text-right font-medium text-slate-700">
                      ₹{lineAmt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-1.5 pl-2">
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeLine(i)}
                          className="text-slate-300 hover:text-red-500 transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addLine}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add line item
        </button>
      </div>

      {/* Totals + settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Invoice Discount %</label>
              <input
                type="number" min="0" max="100" step="0.5" value={discountPct}
                onChange={e => setDiscountPct(parseFloat(e.target.value) || 0)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">GST %</label>
              <select
                value={taxPct}
                onChange={e => setTaxPct(Number(e.target.value))}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {[0, 5, 12, 18, 28].map(t => (
                  <option key={t} value={t}>{t}% GST</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">Due Date</label>
              <input
                type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Appointment ID (optional)</label>
              <input
                value={appointmentId} onChange={e => setAppointmentId(e.target.value)}
                placeholder="UUID"
                className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
            />
          </div>
        </div>

        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>₹{subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            {discountPct > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount ({discountPct}%)</span>
                <span>−₹{discountAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            {taxPct > 0 && (
              <>
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>CGST ({taxPct / 2}%)</span>
                  <span>₹{cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-slate-500 text-xs">
                  <span>SGST ({taxPct / 2}%)</span>
                  <span>₹{sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
            <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold text-slate-800 text-base">
              <span>Total</span>
              <span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </form>
  );
}
