export type DocumentType =
  | 'xray' | 'report' | 'prescription' | 'lab_result'
  | 'consent_form' | 'photo' | 'other';

export interface AiTags {
  auto:       string[];
  suggested:  string[];
  confidence: number;
}

export interface PatientDocument {
  id:           string;
  patientId:    string;
  type:         DocumentType;
  fileName:     string;
  s3Key:        string;
  url:          string;          // fresh presigned URL from API
  mimeType?:    string | null;
  sizeBytes?:   number | null;
  description?: string | null;
  tags:         string[];
  aiTags:       AiTags;
  visitId?:     string | null;
  uploadedBy?:  { fullName: string } | null;
  createdAt:    string;
  updatedAt:    string;
}

export const DOC_TYPE_META: Record<DocumentType, {
  label: string;
  icon:  string;
  color: string;
  bg:    string;
}> = {
  xray:         { label: 'X-Ray',        icon: '🦷', color: 'text-blue-700',   bg: 'bg-blue-50'   },
  report:       { label: 'Report',       icon: '📋', color: 'text-purple-700', bg: 'bg-purple-50' },
  prescription: { label: 'Prescription', icon: '💊', color: 'text-green-700',  bg: 'bg-green-50'  },
  lab_result:   { label: 'Lab Result',   icon: '🔬', color: 'text-orange-700', bg: 'bg-orange-50' },
  consent_form: { label: 'Consent Form', icon: '✍️', color: 'text-slate-700',  bg: 'bg-slate-50'  },
  photo:        { label: 'Photo',        icon: '📸', color: 'text-pink-700',   bg: 'bg-pink-50'   },
  other:        { label: 'Other',        icon: '📄', color: 'text-gray-700',   bg: 'bg-gray-50'   },
};

export const ALL_DOC_TYPES: DocumentType[] = [
  'xray', 'report', 'prescription', 'lab_result', 'consent_form', 'photo', 'other',
];

export function formatBytes(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1_048_576)   return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function isImage(mimeType?: string | null): boolean {
  return !!mimeType?.startsWith('image/');
}

export function isPdf(mimeType?: string | null): boolean {
  return mimeType === 'application/pdf';
}
