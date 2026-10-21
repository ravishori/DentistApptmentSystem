import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorState } from '@/components/ui/error-state';
import { QueryBoundary, StaleNotice } from '@/components/ui/query-boundary';
import { groupState, isStale, viewState } from '@/lib/query-state';
import { Button } from '@/components/ui/button';
import { httpError, leaky500, networkDown, unavailable503 } from './helpers';

/** Walk a React element tree (without a DOM) and return every element matching the predicate. */
function findAll(node: any, pred: (el: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}

describe('viewState: a failed request is never "empty"', () => {
  const ok = { isError: false };
  it.each([
    ['no data yet, not failed', { ...ok, data: undefined }, undefined, 'loading'],
    ['no data, failed', { isError: true, data: undefined, error: new Error('x') }, undefined, 'error'],
    ['failed with an EMPTY-looking default must still be error', { isError: true, data: undefined }, (d: unknown[]) => d.length === 0, 'error'],
    ['data, genuinely empty', { ...ok, data: [] }, (d: unknown[]) => d.length === 0, 'empty'],
    ['data present', { ...ok, data: [1] }, (d: unknown[]) => d.length === 0, 'ready'],
    ['data present but the latest refresh failed', { isError: true, data: [1] }, (d: unknown[]) => d.length === 0, 'ready'],
  ])('%s → %s', (_n, q, isEmpty, expected) => {
    expect(viewState(q as any, isEmpty as any)).toBe(expected);
  });
  it('isStale only when data is on screen AND the refresh failed', () => {
    expect(isStale({ isError: true, data: [1] })).toBe(true);
    expect(isStale({ isError: true, data: undefined })).toBe(false);
    expect(isStale({ isError: false, data: [1] })).toBe(false);
  });
  it('groupState reports the first failure and retries only the failed queries', () => {
    const a = { isError: true, data: undefined, error: 'A', refetch: jest.fn(), isFetching: false };
    const b = { isError: false, data: [1], refetch: jest.fn() };
    const c = { isError: true, data: undefined, error: 'C', refetch: jest.fn(), isFetching: true };
    const g = groupState([a, b, c]);
    expect(g.failed).toHaveLength(2); expect(g.error).toBe('A'); expect(g.fetching).toBe(true);
    g.retry();
    expect(a.refetch).toHaveBeenCalledTimes(1); expect(c.refetch).toHaveBeenCalledTimes(1); expect(b.refetch).not.toHaveBeenCalled();
  });
});

describe('ErrorState', () => {
  it('shows a safe message, the support reference and a retry button for an outage', () => {
    const m = renderToStaticMarkup(<ErrorState title="Could not load patients" error={unavailable503()} onRetry={() => undefined} />);
    expect(m).toContain('role="alert"');
    expect(m).toContain('Could not load patients');
    expect(m).toContain('temporarily unavailable');
    expect(m).toContain('req-ref-12345');
    expect(m).toContain('about 5s');
    expect(m).toContain('Try again');
  });
  it('NEVER shows server internals for a 5xx (SQL, ORM names, paths, patient names)', () => {
    const m = renderToStaticMarkup(<ErrorState error={leaky500()} onRetry={() => undefined} />);
    for (const leak of ['SELECT', 'Prisma', 'C:\\', 'Asha Rao', 'patients WHERE']) expect([leak, m.includes(leak)]).toEqual([leak, false]);
    expect(m).toContain('Something went wrong on our side');
    expect(m).toContain('req-leak-12345');
  });
  it('network failure gets a connectivity message and is retryable', () => {
    const m = renderToStaticMarkup(<ErrorState error={networkDown()} onRetry={() => undefined} />);
    expect(m).toContain('Cannot reach the server'); expect(m).toContain('Try again');
  });
  it('a non-retryable error (403) offers no retry button', () => {
    const m = renderToStaticMarkup(<ErrorState error={httpError(403, { error: { code: 'FORBIDDEN', message: 'You do not have permission to do this.', retryable: false } })} onRetry={() => undefined} />);
    expect(m).toContain('You do not have permission'); expect(m).not.toContain('Try again');
  });
  it('the retry button calls onRetry, and is disabled while a retry is running', () => {
    const onRetry = jest.fn();
    const tree = (ErrorState as any)({ error: unavailable503(), onRetry });
    const [btn] = findAll(tree, (el) => el.type === Button);
    expect(btn.props.disabled).toBeFalsy();
    btn.props.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    const busy = (ErrorState as any)({ error: unavailable503(), onRetry, retrying: true });
    expect(findAll(busy, (el) => el.type === Button)[0].props.disabled).toBe(true);
    expect(renderToStaticMarkup(<ErrorState error={unavailable503()} onRetry={onRetry} retrying />)).toContain('Retrying');
  });
  it('works with only a reference (error boundaries) and with no error at all', () => {
    expect(renderToStaticMarkup(<ErrorState message="An unexpected error occurred." reference="evt-123" />)).toMatch(/evt-123/);
    expect(renderToStaticMarkup(<ErrorState />)).toContain('Something went wrong');
  });
});

describe('QueryBoundary distinguishes loading, failed, empty and ready', () => {
  const render = (q: any, extra: object = {}) => renderToStaticMarkup(
    <QueryBoundary query={q} errorTitle="Could not load things" isEmpty={(d: any[]) => d.length === 0} empty={<p>No things yet</p>} loading={<p>Loading things</p>} {...extra}>
      {(d: any[]) => <ul>{d.map((x) => <li key={x}>{`thing-${x}`}</li>)}</ul>}
    </QueryBoundary>,
  );
  it('loading', () => { const m = render({ isError: false, data: undefined }); expect(m).toContain('Loading things'); expect(m).not.toContain('role="alert"'); });
  it('FAILED is an error with reference, not "No things yet"', () => {
    const m = render({ isError: true, data: undefined, error: unavailable503() });
    expect(m).toContain('Could not load things'); expect(m).toContain('req-ref-12345'); expect(m).not.toContain('No things yet');
  });
  it('genuinely empty is the empty state and NOT an error', () => { const m = render({ isError: false, data: [] }); expect(m).toContain('No things yet'); expect(m).not.toContain('role="alert"'); });
  it('ready renders the data', () => { const m = render({ isError: false, data: [1, 2] }); expect(m).toContain('thing-1'); expect(m).toContain('thing-2'); });
  it('a failed refresh keeps the last data visible with a "may be out of date" notice', () => {
    const m = render({ isError: true, data: [7], error: unavailable503() });
    expect(m).toContain('thing-7'); expect(m).toContain('may be out of date'); expect(m).toContain('role="status"');
  });
  it('the error state wires Retry to the query refetch', () => {
    const refetch = jest.fn();
    const tree = (QueryBoundary as any)({ query: { isError: true, data: undefined, error: networkDown(), refetch, isFetching: false }, children: () => null });
    expect(tree.type).toBe(ErrorState);
    tree.props.onRetry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  it('StaleNotice offers a retry', () => {
    const onRetry = jest.fn();
    const tree = (StaleNotice as any)({ onRetry });
    const [b] = findAll(tree, (el) => el.type === 'button');
    b.props.onClick(); expect(onRetry).toHaveBeenCalled();
  });
});
