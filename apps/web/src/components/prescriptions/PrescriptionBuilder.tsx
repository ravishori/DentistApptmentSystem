'use client';
import React, { useState, useEffect } from 'react';
import { MedicineRow, MedicineItem } from './MedicineRow';
import { prescriptionsApi, usersApi } from '@/lib/api';

interface Props {
  patientId: string;
  visitId?:  string;
  onCreated?: (rx: any) => void;
  onCancel?:  () => void;
}

const EMPTY_ITEM: MedicineItem = {
  medicineName: '', dosage: '', frequency: '', duration: '', instructions: '', quantity: '',
};

export function PrescriptionBuilder({ patientId, visitId, onCreated, onCancel }: Props) {
  const [items, setItems]         = useState<MedicineItem[]>([{ ...EMPTY_ITEM }]);
  const [notes, setNotes]         = useState('');
  const [dentistId, setDentistId] = useState('');
  const [dentists, setDentists]   = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    usersApi.dentists().then(setDentists).catch(() => {});
    prescriptionsApi.listTemplates().then(setTemplates).catch(() => {});
  }, []);

  const loadTemplate = (templateId: string) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl) return;
    const raw: any[] = typeof tmpl.items === 'string' ? JSON.parse(tmpl.items) : tmpl.items;
    setItems(raw.map((i: any) => ({
      medicineName: i.medicineName ?? '',
      dosage:       i.dosage       ?? '',
      frequency:    i.frequency    ?? '',
      duration:     i.duration     ?? '',
      instructions: i.instructions ?? '',
      quantity:     String(i.quantity ?? ''),
    })));
  };

  const addRow    = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeRow = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));
  const changeRow = (i: number, field: keyof MedicineItem, value: string) =>
    setItems(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!dentistId) { setError('Please select a dentist.'); return; }
    const validItems = items.filter(it => it.medicineName && it.dosage && it.frequency && it.duration);
    if (!validItems.length) { setError('Add at least one complete medicine row.'); return; }

    setSaving(true);
    try {
      const rx = await prescriptionsApi.create(patientId, {
        visitId:  visitId ?? undefined,
        dentistId,
        notes:    notes || undefined,
        items:    validItems.map((it, i) => ({
          medicineName: it.medicineName,
          dosage:       it.dosage,
          frequency:    it.frequency,
          duration:     it.duration,
          instructions: it.instructions || undefined,
          quantity:     it.quantity ? Number(it.quantity) : undefined,
          sortOrder:    i,
        })),
      });
      onCreated?.(rx);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save prescription.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">New Prescription</h3>
          <p className="text-xs text-slate-500 mt-0.5">Fill in medicine details and save</p>
        </div>

        {/* Template loader */}
        {templates.length > 0 && (
          <select
            onChange={e => e.target.value && loadTemplate(e.target.value)}
            defaultValue=""
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Load template…</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Dentist selector */}
        <div className="max-w-xs">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
            Prescribing Dentist <span className="text-red-500">*</span>
          </label>
          <select
            value={dentistId}
            onChange={e => setDentistId(e.target.value)}
            required
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select dentist</option>
            {dentists.map((d: any) => (
              <option key={d.id} value={d.id}>Dr. {d.fullName}</option>
            ))}
          </select>
        </div>

        {/* Medicine rows */}
        <div className="space-y-2">
          {items.map((item, i) => (
            <MedicineRow
              key={i}
              index={i}
              item={item}
              onChange={changeRow}
              onRemove={removeRow}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Medicine
        </button>

        {/* Notes */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
            Clinical Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional notes for the patient…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-100"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium flex items-center gap-2"
        >
          {saving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Saving…
            </>
          ) : 'Save Prescription'}
        </button>
      </div>
    </form>
  );
}
