'use client';
import React, { useCallback, useRef, useState } from 'react';
import { DocumentType, ALL_DOC_TYPES, DOC_TYPE_META } from './types';
import { documentsApi } from '@/lib/api';

interface Props {
  patientId: string;
  visitId?:  string;
  onUploaded: (doc: any) => void;
}

const ACCEPTED = '.jpg,.jpeg,.png,.webp,.tiff,.pdf,.dcm,.doc,.docx';
const MAX_MB   = 50;

export function DocumentUploader({ patientId, visitId, onUploaded }: Props) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]   = useState(false);
  const [file,     setFile]       = useState<File | null>(null);
  const [docType,  setDocType]    = useState<DocumentType>('other');
  const [desc,     setDesc]       = useState('');
  const [tags,     setTags]       = useState('');
  const [progress, setProgress]   = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error,    setError]      = useState('');

  const accept = (f: File) => {
    if (f.size > MAX_MB * 1_048_576) { setError(`File must be under ${MAX_MB} MB`); return; }
    setFile(f);
    setError('');
    // Auto-infer doc type from filename
    const name = f.name.toLowerCase();
    if (/x[-_]?ray|xray|pano|opg|cbct|radiograph|periapical|bitewing/.test(name)) setDocType('xray');
    else if (/report|lab|blood|cbc|urine|culture/.test(name)) setDocType('lab_result');
    else if (/prescription|rx|medicine/.test(name)) setDocType('prescription');
    else if (/consent|form|waiver/.test(name)) setDocType('consent_form');
    else if (f.type.startsWith('image/')) setDocType('photo');
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) accept(dropped);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('Please select a file.'); return; }
    setError('');
    setUploading(true);
    setProgress(0);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('type', docType);
    if (visitId) fd.append('visitId', visitId);
    if (desc)    fd.append('description', desc);
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length) fd.append('tags', JSON.stringify(tagList));

    try {
      const doc = await documentsApi.upload(patientId, fd, setProgress);
      onUploaded(doc);
      setFile(null); setDesc(''); setTags(''); setProgress(0); setDocType('other');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800">Upload Document</h3>
        <p className="text-xs text-slate-500 mt-0.5">X-rays, reports, prescriptions, photos — up to {MAX_MB} MB</p>
      </div>

      <div className="px-6 py-5 space-y-5">
        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors ${
            dragging
              ? 'border-blue-400 bg-blue-50'
              : file
              ? 'border-green-400 bg-green-50'
              : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={e => e.target.files?.[0] && accept(e.target.files[0])}
          />

          {file ? (
            <>
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="font-medium text-slate-800 text-sm">{file.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {(file.size / 1_048_576).toFixed(2)} MB · {file.type || 'unknown type'}
              </p>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setFile(null); }}
                className="mt-2 text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">Drop file here or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">JPG, PNG, PDF, DICOM, DOCX</p>
            </>
          )}
        </div>

        {/* Doc type selector */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">
            Document Type <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {ALL_DOC_TYPES.map(t => {
              const meta = DOC_TYPE_META[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDocType(t)}
                  className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border text-xs transition-all ${
                    docType === t
                      ? `${meta.bg} border-current ${meta.color} font-semibold shadow-sm`
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span className="text-lg leading-none">{meta.icon}</span>
                  <span className="leading-tight text-center">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
              Description
            </label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Full mouth OPG"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">
              Tags <span className="text-slate-400 font-normal">(comma-separated)</span>
            </label>
            <input
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="panoramic, pre-treatment"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1.5">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
        <button
          type="submit"
          disabled={uploading || !file}
          className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {uploading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Uploading {progress}%
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload
            </>
          )}
        </button>
      </div>
    </form>
  );
}
