'use client';
import React from 'react';

export interface MedicineItem {
  medicineName: string;
  dosage:       string;
  frequency:    string;
  duration:     string;
  instructions: string;
  quantity:     string;
}

interface Props {
  index: number;
  item: MedicineItem;
  onChange: (index: number, field: keyof MedicineItem, value: string) => void;
  onRemove: (index: number) => void;
}

const FREQUENCIES = ['OD', 'BD', 'TID', 'QID', 'SOS', 'HS', 'AC', 'PC', 'Stat'];
const DURATIONS   = ['1 day', '3 days', '5 days', '7 days', '10 days', '14 days', '1 month', 'As needed'];

export function MedicineRow({ index, item, onChange, onRemove }: Props) {
  const field = (f: keyof MedicineItem) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange(index, f, e.target.value);

  return (
    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr_auto_auto] gap-2 items-end">
      {/* Medicine name */}
      <div>
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Medicine</label>}
        <input
          value={item.medicineName}
          onChange={field('medicineName')}
          placeholder="e.g. Amoxicillin 500mg"
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Dosage */}
      <div>
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Dose</label>}
        <input
          value={item.dosage}
          onChange={field('dosage')}
          placeholder="1 tablet"
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Frequency */}
      <div>
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Frequency</label>}
        <select
          value={item.frequency}
          onChange={field('frequency')}
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Select</option>
          {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {/* Duration */}
      <div>
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Duration</label>}
        <select
          value={item.duration}
          onChange={field('duration')}
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">Select</option>
          {DURATIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Instructions */}
      <div>
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Instructions</label>}
        <input
          value={item.instructions}
          onChange={field('instructions')}
          placeholder="e.g. After meals"
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Quantity */}
      <div className="w-14">
        {index === 0 && <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Qty</label>}
        <input
          type="number"
          min="1"
          value={item.quantity}
          onChange={field('quantity')}
          placeholder="—"
          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Remove */}
      <div>
        {index === 0 && <div className="mb-1 h-4" />}
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
          title="Remove"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
