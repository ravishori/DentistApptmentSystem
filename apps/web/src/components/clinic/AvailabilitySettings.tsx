'use client';
import React, { useState, useEffect } from 'react';
import { clinicMgmtApi } from '@/lib/api';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

const DAYS = [
  { value: 'monday',    label: 'Mon' },
  { value: 'tuesday',   label: 'Tue' },
  { value: 'wednesday', label: 'Wed' },
  { value: 'thursday',  label: 'Thu' },
  { value: 'friday',    label: 'Fri' },
  { value: 'saturday',  label: 'Sat' },
  { value: 'sunday',    label: 'Sun' },
];

const SLOT_DURATIONS = [10, 15, 20, 30, 45, 60];

export function AvailabilitySettings() {
  const [doctors,     setDoctors]     = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState('');
  const [rules,       setRules]       = useState<any[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState({
    dayOfWeek: 'monday', startTime: '09:00', endTime: '17:00', slotMins: 30,
  });
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  // Generate slots state
  const [genFrom,   setGenFrom]   = useState('');
  const [genTo,     setGenTo]     = useState('');
  const [autoChair, setAutoChair] = useState(true);
  const [genResult, setGenResult] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    clinicMgmtApi.getDoctors().then((docs: any[]) => {
      setDoctors(docs);
      if (docs.length) setSelectedDoc(docs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDoc) return;
    setLoading(true);
    clinicMgmtApi.listAvailabilities(selectedDoc)
      .then(setRules)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedDoc]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await clinicMgmtApi.createAvailability({ ...form, dentistId: selectedDoc, slotMins: Number(form.slotMins) });
      const updated = await clinicMgmtApi.listAvailabilities(selectedDoc);
      setRules(updated);
      setShowForm(false);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this availability rule?')) return;
    await clinicMgmtApi.deleteAvailability(id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true); setGenResult(null);
    try {
      const result = await clinicMgmtApi.generateSlots({
        dentistId: selectedDoc,
        from: genFrom, to: genTo,
        autoAssignChair: autoChair,
      });
      setGenResult(result);
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Doctor selector */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Doctor</h3>
        <div className="flex flex-wrap gap-2">
          {doctors.map((d: any) => (
            <button key={d.id} onClick={() => setSelectedDoc(d.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all text-sm font-medium ${
                selectedDoc === d.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200'
              }`}>
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold">
                {d.fullName?.charAt(0)}
              </div>
              {d.fullName}
            </button>
          ))}
        </div>
      </div>

      {selectedDoc && (
        <>
          {/* Availability rules */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-700">Weekly Availability Rules</h3>
              <button onClick={() => setShowForm(!showForm)}
                className="text-sm font-medium text-blue-600 border border-blue-200 px-4 py-2 rounded-xl hover:bg-blue-50 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Rule
              </button>
            </div>

            {showForm && (
              <form onSubmit={handleSave} className="bg-slate-50 rounded-xl p-4 mb-4 space-y-3">
                {error && <p className="text-xs text-red-600">{error}</p>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Day</label>
                    <select value={form.dayOfWeek} onChange={e => setForm(f => ({ ...f, dayOfWeek: e.target.value }))}
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      {DAYS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Start</label>
                    <input type="time" value={form.startTime}
                      onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">End</label>
                    <input type="time" value={form.endTime}
                      onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Slot (mins)</label>
                    <select value={form.slotMins} onChange={e => setForm(f => ({ ...f, slotMins: Number(e.target.value) }))}
                      className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      {SLOT_DURATIONS.map(d => <option key={d} value={d}>{d} min</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowForm(false)}
                    className="px-4 py-2 text-sm border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600">Cancel</button>
                  <button type="submit" disabled={saving}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save Rule'}
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-primary" label="Loading" /></div>
            ) : rules.length === 0 ? (
              <EmptyState title="No rules yet. Add one to define working hours." className="py-8" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {rules.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 capitalize">{r.dayOfWeek}</p>
                      <p className="text-xs text-slate-500">{r.startTime}–{r.endTime} · {r.slotMins}min slots</p>
                    </div>
                    <button onClick={() => handleDelete(r.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generate slots */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Generate Appointment Slots</h3>
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500">From</label>
                  <input type="date" value={genFrom} onChange={e => setGenFrom(e.target.value)} required
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">To</label>
                  <input type="date" value={genTo} onChange={e => setGenTo(e.target.value)} required
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={autoChair} onChange={e => setAutoChair(e.target.checked)}
                      className="w-4 h-4 rounded" />
                    Auto-assign chairs
                  </label>
                </div>
              </div>
              {genResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
                  Generated <strong>{genResult.created}</strong> slots ({genResult.skipped} skipped / already existed)
                </div>
              )}
              <button type="submit" disabled={generating || !rules.length}
                className="px-6 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50">
                {generating ? 'Generating…' : 'Generate Slots'}
              </button>
              {!rules.length && (
                <p className="text-xs text-slate-400">Add availability rules first</p>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  );
}
