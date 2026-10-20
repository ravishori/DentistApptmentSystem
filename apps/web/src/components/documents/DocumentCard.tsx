'use client';
import React, { useState } from 'react';
import { PatientDocument, DOC_TYPE_META, formatBytes, isImage, isPdf } from './types';
import { documentsApi } from '@/lib/api';

interface Props {
  doc:       PatientDocument;
  onDeleted: (id: string) => void;
  onUpdated: (doc: PatientDocument) => void;
}

export function DocumentCard({ doc, onDeleted, onUpdated }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [editing,     setEditing]     = useState(false);
  const [tagInput,    setTagInput]    = useState(doc.tags.join(', '));
  const [descInput,   setDescInput]   = useState(doc.description ?? '');
  const [saving,      setSaving]      = useState(false);
  const [deleting,    setDeleting]    = useState(false);

  const meta    = DOC_TYPE_META[doc.type];
  const image   = isImage(doc.mimeType);
  const pdf     = isPdf(doc.mimeType);
  const dateStr = new Date(doc.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await documentsApi.update(doc.patientId ?? '', doc.id, {
        description: descInput || undefined,
        tags: tagInput.split(',').map(t => t.trim()).filter(Boolean),
      });
      onUpdated({ ...doc, ...updated });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${doc.fileName}"?`)) return;
    setDeleting(true);
    try {
      await documentsApi.remove(doc.patientId ?? '', doc.id);
      onDeleted(doc.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className={`group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col`}>
        {/* Thumbnail / icon area */}
        <div
          className={`relative flex items-center justify-center h-36 cursor-pointer overflow-hidden ${meta.bg}`}
          onClick={() => setShowPreview(true)}
        >
          {image ? (
            <img
              src={doc.url}
              alt={doc.fileName}
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <span className="text-5xl">{meta.icon}</span>
          )}

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 bg-white/90 text-slate-700 text-xs font-medium px-3 py-1 rounded-full transition-opacity">
              {image || pdf ? 'Preview' : 'Download'}
            </span>
          </div>

          {/* Type badge */}
          <span className={`absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} border border-current/20`}>
            {meta.label}
          </span>
        </div>

        {/* Body */}
        <div className="p-3 flex flex-col gap-1.5 flex-1">
          <p className="text-sm font-medium text-slate-800 leading-tight truncate" title={doc.fileName}>
            {doc.fileName}
          </p>

          <p className="text-[11px] text-slate-400">
            {dateStr}
            {doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ''}
            {doc.uploadedBy ? ` · ${doc.uploadedBy.fullName}` : ''}
          </p>

          {doc.description && (
            <p className="text-xs text-slate-500 truncate">{doc.description}</p>
          )}

          {/* Tags */}
          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {doc.tags.slice(0, 4).map(tag => (
                <span key={tag} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
                  {tag}
                </span>
              ))}
              {doc.tags.length > 4 && (
                <span className="text-[10px] text-slate-400">+{doc.tags.length - 4}</span>
              )}
            </div>
          )}

          {/* AI suggested tags */}
          {doc.aiTags?.suggested?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {doc.aiTags.suggested.slice(0, 3).map(tag => (
                <span key={tag} className="text-[10px] bg-blue-50 text-blue-500 border border-blue-100 px-1.5 py-0.5 rounded-full italic">
                  ✨ {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center border-t border-slate-100 divide-x divide-slate-100">
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
            </svg>
            Download
          </a>
          <button
            onClick={() => setEditing(true)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {deleting ? '…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <p className="font-medium text-slate-800 text-sm truncate">{doc.fileName}</p>
              <button onClick={() => setShowPreview(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <div className="overflow-auto max-h-[80vh] flex items-center justify-center bg-slate-900 p-4">
              {image && (
                <img src={doc.url} alt={doc.fileName} className="max-w-full max-h-[75vh] object-contain rounded" />
              )}
              {pdf && (
                <iframe src={doc.url} className="w-full h-[75vh]" title={doc.fileName} />
              )}
              {!image && !pdf && (
                <div className="text-center text-slate-400 py-12">
                  <span className="text-6xl">{meta.icon}</span>
                  <p className="mt-4 text-sm">Preview not available</p>
                  <a href={doc.url} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm underline">
                    Download file
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-800">Edit Document</h3>
              <button onClick={() => setEditing(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Description</label>
                <input
                  value={descInput}
                  onChange={e => setDescInput(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Tags (comma-separated)</label>
                <input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
