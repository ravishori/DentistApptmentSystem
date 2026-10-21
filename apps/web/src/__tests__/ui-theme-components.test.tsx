import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { ThemeSelector } from '@/components/layout/theme-selector';
import { NAV } from '@/components/layout/nav-items';
import { THEMES, THEME_IDS } from '@/lib/theme';
import { formatDentist } from '@/lib/utils';
import { chartColor, CHART_GRID } from '@/lib/chart-theme';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('ThemeSelector', () => {
  const html = render(<ThemeSelector />);

  it('is one labelled radio group with System + all seven themes', () => {
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Colour theme"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(THEME_IDS.length + 1);
    for (const t of THEMES) expect(html).toContain(t.label.replace('&', '&amp;'));
    expect(html).toContain('System');
  });

  it('previews each theme inside its own data-theme scope (real tokens, not screenshots)', () => {
    for (const id of THEME_IDS) expect(html).toContain(`data-theme="${id}"`);
  });

  it('marks exactly one option as checked and gives every option a touch-sized target', () => {
    expect((html.match(/aria-checked="true"/g) ?? []).length).toBe(1);
    expect((html.match(/min-h-\[44px\]/g) ?? []).length).toBe(THEME_IDS.length + 1);
  });
});

describe('StatusBadge: status is never colour alone', () => {
  const statuses = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled', 'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'pending', 'active', 'inactive'];

  it.each(statuses)('%s renders an icon and a readable text label', (status) => {
    const html = render(<StatusBadge status={status} />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(status.replace(/_/g, ' '));
    expect(html).toContain(`data-status="${status}"`);
  });

  it('falls back safely for unknown / missing status', () => {
    expect(render(<StatusBadge status="weird" />)).toContain('weird');
    expect(render(<StatusBadge status={undefined} />)).toContain('unknown');
  });
});

describe('navigation parity', () => {
  it('lists every destination once, each with a label and an icon', () => {
    const hrefs = NAV.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const n of NAV) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(n.icon).toBeDefined();
    }
    expect(hrefs).toEqual(expect.arrayContaining(['/dashboard', '/appointments', '/patients', '/billing', '/settings']));
  });
});

describe('themed states render with token classes only (no hard-coded colours)', () => {
  it.each(THEME_IDS)('%s: empty and error states use semantic tokens', (id) => {
    const html = render(
      <div data-theme={id}>
        <EmptyState title="No invoices yet" description="Create your first invoice." />
        <ErrorState title="Could not load invoices" error={new Error('boom')} onRetry={() => undefined} retrying={false} />
      </div>,
    );
    expect(html).toContain('No invoices yet');
    expect(html).toContain('Could not load invoices');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('helpers', () => {
  it('formatDentist never doubles the title', () => {
    expect(formatDentist('Asha Rao')).toBe('Dr. Asha Rao');
    expect(formatDentist('Dr. Asha Rao')).toBe('Dr. Asha Rao');
    expect(formatDentist('dr asha')).toBe('dr asha');
    expect(formatDentist(undefined)).toBe('Dentist');
  });

  it('chart colours are theme variables (no fixed hex)', () => {
    expect(chartColor(1)).toBe('hsl(var(--chart-1))');
    expect(chartColor(9)).toBe('hsl(var(--chart-1))');
    expect(CHART_GRID).toContain('var(--chart-grid)');
  });
});
