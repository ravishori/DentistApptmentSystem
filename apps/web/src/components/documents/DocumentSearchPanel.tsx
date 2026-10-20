'use client';
import React from 'react';
import { DocumentType, ALL_DOC_TYPES, DOC_TYPE_META } from './types';
import { useDebounce } from 'use-debounce';

export interface SearchFilters {
  q?:    string;
  type?: DocumentType | '';
  from?: string;
  to?:   string;
  tag?:  string;
}

interface Props {
  filters:   SearchFilters;
  onChange:  (f: SearchFilters) => void;
  total:     number;
  loading:   boolean;
}

export function DocumentSearchPanel({ filters, onChange, total, loading }: Props) {
  const set = (key: keyof SearchFilters, value: string) =>
    onChange({ ...filters, [key]: value || undefined });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-4">
      {/* Keyword */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          value={filters.q ?? ''}
          onChange={e => set('q', e.target.value)}
          placeholder="Search by filename, description, tags…"
          className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {loading && (
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* Document type */}
        <div className="flex-1 min-w-[140px]">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Type</label>
          <select
            value={filters.type ?? ''}
            onChange={e => set('type', e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All types</option>
            {ALL_DOC_TYPES.map(t => (
              <option key={t} value={t}>{DOC_TYPE_META[t].icon} {DOC_TYPE_META[t].label}</option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div className="flex-1 min-w-[130px]">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">From</label>
          <input
            type="date"
            value={filters.from ?? ''}
            onChange={e => set('from', e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Date to */}
        <div className="flex-1 min-w-[130px]">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">To</label>
          <input
            type="date"
            value={filters.to ?? ''}
            onChange={e => set('to', e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Tag */}
        <div className="flex-1 min-w-[120px]">
          <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide block mb-1">Tag</label>
          <input
            value={filters.tag ?? ''}
            onChange={e => set('tag', e.target.value)}
            placeholder="e.g. xray"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Clear */}
        {(filters.q || filters.type || filters.from || filters.to || filters.tag) && (
          <button
            onClick={() => onChange({})}
            className="px-3 py-2 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{total} document{total !== 1 ? 's' : ''}</span>
        {filters.type && (
          <span className={`font-medium ${DOC_TYPE_META[filters.type as DocumentType].color}`}>
            {DOC_TYPE_META[filters.type as DocumentType].icon} {DOC_TYPE_META[filters.type as DocumentType].label}
          </span>
        )}
      </div>
    </div>
  );
}
