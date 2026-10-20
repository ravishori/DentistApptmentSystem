'use client';
import React, { useState, useEffect } from 'react';
import { Tooth, ToothCondition, ToothSurface, CONDITION_LABELS, CONDITION_COLORS } from './types';

interface Props {
  tooth: Tooth | null;
  onClose: () => void;
  onSave: (fdi: number, data: { condition: ToothCondition; affectedSurfaces: ToothSurface[]; notes?: string }) => Promise<void>;
}

const ALL_CONDITIONS: ToothCondition[] = [
  'healthy','decayed','filled','missing','crown','implant',
  'root_canal','bridge','fractured','extracted','unerupted','impacted','watch','veneer',
];

const ALL_SURFACES: ToothSurface[] = ['mesial','distal','buccal','lingual','occlusal','incisal'];

export function ToothModal({ tooth, onClose, onSave }: Props) {
  const [condition, setCondition]   = useState<ToothCondition>('healthy');
  const [surfaces, setSurfaces]     = useState<ToothSurface[]>([]);
  const [notes, setNotes]           = useState('');
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (tooth) {
      setCondition(tooth.condition);
      setSurfaces(tooth.affectedSurfaces ?? []);
      setNotes(tooth.notes ?? '');
    }
  }, [tooth]);

  if (!tooth) return null;

  const toggleSurface = (s: ToothSurface) =>
    setSurfaces(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(tooth.fdiNumber, { condition, affectedSurfaces: surfaces, notes: notes || undefined });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-semibold text-slate-800">Tooth {tooth.fdiNumber}</h3>
            <p className="text-xs text-slate-500 mt-0.5">Update condition and notes</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >×</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Condition */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
              Condition
            </label>
            <div className="grid grid-cols-4 gap-2">
              {ALL_CONDITIONS.map(c => (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-all ${
                    condition === c
                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span
                    className="w-4 h-4 rounded-sm border"
                    style={{ backgroundColor: CONDITION_COLORS[c], borderColor: '#94a3b8' }}
                  />
                  {CONDITION_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Affected surfaces */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
              Affected Surfaces
            </label>
            <div className="flex flex-wrap gap-2">
              {ALL_SURFACES.map(s => (
                <button
                  key={s}
                  onClick={() => toggleSurface(s)}
                  className={`px-3 py-1 rounded-full border text-xs font-medium transition-all capitalize ${
                    surfaces.includes(s)
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-slate-300 text-slate-600 hover:border-blue-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">
              Clinical Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
