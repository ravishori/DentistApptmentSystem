'use client';
import React, { useState, useCallback } from 'react';
import { DentalChart as ChartType, Tooth, ToothCondition, ToothSurface, UPPER_RIGHT, UPPER_LEFT, LOWER_LEFT, LOWER_RIGHT } from './types';
import { ToothSVG } from './ToothSVG';
import { ToothModal } from './ToothModal';
import { ChartLegend } from './ChartLegend';
import { ehrApi } from '@/lib/api';

interface Props {
  patientId: string;
  chart: ChartType;
  onChartUpdated: (updated: ChartType) => void;
  readOnly?: boolean;
}

function toothByFdi(chart: ChartType, fdi: number): Tooth | undefined {
  return chart.teeth.find(t => t.fdiNumber === fdi);
}

export function DentalChart({ patientId, chart: initialChart, onChartUpdated, readOnly }: Props) {
  const [chart, setChart]             = useState<ChartType>(initialChart);
  const [selectedTooth, setSelected]  = useState<Tooth | null>(null);

  const handleToothClick = useCallback((tooth: Tooth) => {
    if (!readOnly) setSelected(tooth);
  }, [readOnly]);

  const handleSave = useCallback(async (
    fdi: number,
    data: { condition: ToothCondition; affectedSurfaces: ToothSurface[]; notes?: string },
  ) => {
    const updated = await ehrApi.updateTooth(patientId, fdi, data);
    setChart(prev => ({
      ...prev,
      teeth: prev.teeth.map(t => t.fdiNumber === fdi ? { ...t, ...updated } : t),
    }));
    onChartUpdated({ ...chart, teeth: chart.teeth.map(t => t.fdiNumber === fdi ? { ...t, ...updated } : t) });
  }, [patientId, chart, onChartUpdated]);

  const renderRow = (fdis: number[], label: string, flip = false) => (
    <div className="flex items-center gap-1">
      {flip ? (
        <>
          {fdis.map(fdi => {
            const tooth = toothByFdi(chart, fdi);
            return tooth ? (
              <ToothSVG key={fdi} tooth={tooth} onClick={handleToothClick} />
            ) : (
              <div key={fdi} className="w-11 h-14 rounded bg-slate-100 border border-dashed border-slate-200" />
            );
          })}
          <span className="text-[10px] text-slate-400 w-6 text-right ml-1">{label}</span>
        </>
      ) : (
        <>
          <span className="text-[10px] text-slate-400 w-6 mr-1">{label}</span>
          {fdis.map(fdi => {
            const tooth = toothByFdi(chart, fdi);
            return tooth ? (
              <ToothSVG key={fdi} tooth={tooth} onClick={handleToothClick} />
            ) : (
              <div key={fdi} className="w-11 h-14 rounded bg-slate-100 border border-dashed border-slate-200" />
            );
          })}
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Chart grid */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 overflow-x-auto">
        <div className="min-w-max space-y-1">
          {/* Upper jaw label */}
          <div className="flex justify-center mb-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Upper Jaw</span>
          </div>

          {/* Upper row: right (18→11) | left (21→28) */}
          <div className="flex items-center justify-center gap-3">
            {renderRow(UPPER_RIGHT, 'R')}
            <div className="w-px h-14 bg-slate-200 mx-1" />
            {renderRow(UPPER_LEFT, 'L', true)}
          </div>

          {/* Midline */}
          <div className="flex items-center justify-center gap-3 my-2">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] text-slate-400 px-2">Midline</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Lower row: left (31→38) | right (48→41) */}
          <div className="flex items-center justify-center gap-3">
            {renderRow(LOWER_LEFT, 'L')}
            <div className="w-px h-14 bg-slate-200 mx-1" />
            {renderRow(LOWER_RIGHT, 'R', true)}
          </div>

          {/* Lower jaw label */}
          <div className="flex justify-center mt-1">
            <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">Lower Jaw</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <ChartLegend />

      {/* Modal */}
      <ToothModal
        tooth={selectedTooth}
        onClose={() => setSelected(null)}
        onSave={handleSave}
      />
    </div>
  );
}
