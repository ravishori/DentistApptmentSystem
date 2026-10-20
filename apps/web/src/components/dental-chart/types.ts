export type ToothCondition =
  | 'healthy' | 'decayed' | 'filled' | 'missing' | 'crown'
  | 'implant' | 'root_canal' | 'bridge' | 'fractured' | 'extracted'
  | 'unerupted' | 'impacted' | 'watch' | 'veneer';

export type ToothSurface = 'mesial' | 'distal' | 'buccal' | 'lingual' | 'occlusal' | 'incisal';

export interface Tooth {
  id: string;
  fdiNumber: number;
  condition: ToothCondition;
  affectedSurfaces: ToothSurface[];
  notes?: string | null;
  history: any[];
}

export interface DentalChart {
  id: string;
  patientId: string;
  teeth: Tooth[];
}

export const CONDITION_COLORS: Record<ToothCondition, string> = {
  healthy:    '#22c55e',
  decayed:    '#ef4444',
  filled:     '#3b82f6',
  missing:    '#94a3b8',
  crown:      '#f59e0b',
  implant:    '#8b5cf6',
  root_canal: '#ec4899',
  bridge:     '#06b6d4',
  fractured:  '#f97316',
  extracted:  '#6b7280',
  unerupted:  '#d1d5db',
  impacted:   '#fbbf24',
  watch:      '#facc15',
  veneer:     '#a78bfa',
};

export const CONDITION_LABELS: Record<ToothCondition, string> = {
  healthy:    'Healthy',
  decayed:    'Decayed',
  filled:     'Filled',
  missing:    'Missing',
  crown:      'Crown',
  implant:    'Implant',
  root_canal: 'Root Canal',
  bridge:     'Bridge',
  fractured:  'Fractured',
  extracted:  'Extracted',
  unerupted:  'Unerupted',
  impacted:   'Impacted',
  watch:      'Watch',
  veneer:     'Veneer',
};

// FDI quadrant grouping
export const UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11]; // Q1
export const UPPER_LEFT  = [21, 22, 23, 24, 25, 26, 27, 28]; // Q2
export const LOWER_LEFT  = [31, 32, 33, 34, 35, 36, 37, 38]; // Q3
export const LOWER_RIGHT = [48, 47, 46, 45, 44, 43, 42, 41]; // Q4
