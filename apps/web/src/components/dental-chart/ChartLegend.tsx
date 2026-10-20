'use client';
import React from 'react';
import { CONDITION_COLORS, CONDITION_LABELS, ToothCondition } from './types';

export function ChartLegend() {
  const entries = Object.entries(CONDITION_COLORS) as [ToothCondition, string][];

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 py-3 bg-slate-50 rounded-lg border border-slate-100 text-xs">
      {entries.map(([cond, color]) => (
        <span key={cond} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm border border-slate-300"
            style={{ backgroundColor: color }}
          />
          <span className="text-slate-600">{CONDITION_LABELS[cond]}</span>
        </span>
      ))}
    </div>
  );
}
