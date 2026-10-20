'use client';
import React from 'react';
import { Tooth, CONDITION_COLORS, CONDITION_LABELS } from './types';

interface Props {
  tooth: Tooth;
  onClick: (tooth: Tooth) => void;
  size?: number;
}

export function ToothSVG({ tooth, onClick, size = 44 }: Props) {
  const color = CONDITION_COLORS[tooth.condition];
  const isMolar = [6, 7, 8].includes(tooth.fdiNumber % 10);
  const label  = CONDITION_LABELS[tooth.condition];

  return (
    <button
      title={`Tooth ${tooth.fdiNumber} — ${label}`}
      onClick={() => onClick(tooth)}
      className="group relative flex flex-col items-center gap-0.5 hover:scale-110 transition-transform focus:outline-none"
    >
      <svg
        width={size}
        height={size + 4}
        viewBox="0 0 44 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {isMolar ? (
          // Molar shape
          <>
            <rect x="4" y="6" width="36" height="36" rx="8" fill={color} stroke="#1e293b" strokeWidth="1.5" />
            <line x1="22" y1="6" x2="22" y2="42" stroke="#1e293b" strokeWidth="1" opacity="0.4" />
            <line x1="4" y1="24" x2="40" y2="24" stroke="#1e293b" strokeWidth="1" opacity="0.4" />
          </>
        ) : (
          // Incisor / canine / premolar shape
          <>
            <ellipse cx="22" cy="26" rx="14" ry="18" fill={color} stroke="#1e293b" strokeWidth="1.5" />
            <ellipse cx="22" cy="14" rx="7" ry="8" fill={color} stroke="#1e293b" strokeWidth="1" opacity="0.7" />
          </>
        )}
        {tooth.condition === 'missing' || tooth.condition === 'extracted' ? (
          <>
            <line x1="10" y1="10" x2="34" y2="38" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="34" y1="10" x2="10" y2="38" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
          </>
        ) : null}
      </svg>
      <span className="text-[9px] font-semibold text-slate-600 leading-none">
        {tooth.fdiNumber}
      </span>
      {tooth.affectedSurfaces.length > 0 && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border border-white" />
      )}
    </button>
  );
}
