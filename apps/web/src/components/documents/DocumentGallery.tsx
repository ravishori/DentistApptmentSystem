'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PatientDocument } from './types';
import { DocumentCard } from './DocumentCard';
import { DocumentSearchPanel, SearchFilters } from './DocumentSearchPanel';
import { documentsApi } from '@/lib/api';
import { useDebounce } from 'use-debounce';

interface Props {
  patientId:   string;
  initialDocs?: PatientDocument[];
  onTotalChange?: (n: number) => void;
}

type ViewMode = 'grid' | 'list';

export function DocumentGallery({ patientId, initialDocs, onTotalChange }: Props) {
  const [docs,    setDocs]    = useState<PatientDocument[]>(initialDocs ?? []);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [view,    setView]    = useState<ViewMode>('grid');

  const [debouncedFilters] = useDebounce(filters, 350);

  const isSearching = !!(
    debouncedFilters.q || debouncedFilters.type ||
    debouncedFilters.from || debouncedFilters.to || debouncedFilters.tag
  );

  const fetchDocs = useCallback(async (p: number, f: SearchFilters) => {
    setLoading(true);
    try {
      const hasFilters = !!(f.q || f.type || f.from || f.to || f.tag);
      const result = hasFilters
        ? await documentsApi.search(patientId, { ...f, page: p, limit: 24 })
        : await documentsApi.list(patientId, p, 24);

      setDocs(prev => p === 1 ? result.items : [...prev, ...result.items]);
      setTotal(result.total);
      onTotalChange?.(result.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [patientId, onTotalChange]);

  // Refetch when filters or page changes
  useEffect(() => {
    setPage(1);
  }, [debouncedFilters]);

  useEffect(() => {
    fetchDocs(page, debouncedFilters);
  }, [page, debouncedFilters, fetchDocs]);

  const handleDeleted = (id: string) => {
    setDocs(prev => prev.filter(d => d.id !== id));
    setTotal(t => Math.max(0, t - 1));
  };

  const handleUpdated = (updated: PatientDocument) =>
    setDocs(prev => prev.map(d => d.id === updated.id ? updated : d));

  const hasMore = docs.length < total;

  return (
    <div className="space-y-4">
      {/* Search + filter panel */}
      <DocumentSearchPanel
        filters={filters}
        onChange={f => setFilters(f)}
        total={total}
        loading={loading}
      />

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {isSearching && (
            <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
              Search results
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
          <button
            onClick={() => setView('grid')}
            className={`p-1.5 rounded transition-colors ${view === 'grid' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
            title="Grid view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded transition-colors ${view === 'list' ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:text-slate-600'}`}
            title="List view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!loading && docs.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <svg className="w-14 h-14 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
          </svg>
          <p className="font-medium">
            {isSearching ? 'No documents match your search' : 'No documents yet'}
          </p>
          {isSearching && (
            <button onClick={() => setFilters({})} className="mt-2 text-sm text-blue-500 hover:text-blue-600">
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Grid or list */}
      {docs.length > 0 && (
        view === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {docs.map(doc => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {docs.map(doc => (
              <DocumentListRow
                key={doc.id}
                doc={doc}
                onDeleted={handleDeleted}
                onUpdated={handleUpdated}
              />
            ))}
          </div>
        )
      )}

      {/* Loading skeleton */}
      {loading && docs.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-100 rounded-2xl h-52 animate-pulse" />
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setPage(p => p + 1)}
            className="px-6 py-2.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition-colors"
          >
            Load more ({total - docs.length} remaining)
          </button>
        </div>
      )}

      {loading && docs.length > 0 && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

// ── List row variant ───────────────────────────────────────────────────────────

function DocumentListRow({
  doc, onDeleted, onUpdated,
}: { doc: PatientDocument; onDeleted: (id: string) => void; onUpdated: (d: PatientDocument) => void }) {
  const meta    = DOC_TYPE_META[doc.type];
  const dateStr = new Date(doc.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors group">
      {/* Icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-lg ${meta.bg}`}>
        {meta.icon}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{doc.fileName}</p>
        <p className="text-xs text-slate-400">
          <span className={`font-medium ${meta.color}`}>{meta.label}</span>
          {' · '}{dateStr}
          {doc.description ? ` · ${doc.description}` : ''}
        </p>
        {doc.tags.length > 0 && (
          <div className="flex gap-1 mt-0.5">
            {doc.tags.slice(0, 5).map(t => (
              <span key={t} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors"
          title="Download"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
          </svg>
        </a>
        <button
          onClick={async () => {
            if (!confirm(`Delete "${doc.fileName}"?`)) return;
            await documentsApi.remove(doc.patientId ?? '', doc.id);
            onDeleted(doc.id);
          }}
          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"
          title="Delete"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

