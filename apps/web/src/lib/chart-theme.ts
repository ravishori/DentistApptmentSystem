import * as React from 'react';
/**
 * Chart colours come from the active theme's CSS variables (tokens.css: --chart-1..8, --chart-grid,
 * --chart-axis), so charts re-colour with the theme and keep contrast in every theme.
 */
export const chartColor = (n: number): string => `hsl(var(--chart-${((n - 1) % 8) + 1}))`;
export const CHART_GRID = 'hsl(var(--chart-grid))';
export const CHART_AXIS = 'hsl(var(--chart-axis))';
export const CHART_TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--popover))',
  color: 'hsl(var(--popover-foreground))',
  fontSize: 12,
} as const;

/** Legend labels stay in the readable text colour; the swatch icon carries the series colour. */
export const legendLabel = (value: string | number): React.ReactNode =>
  React.createElement('span', { style: { color: 'hsl(var(--foreground))' } }, String(value));
