/**
 * Shared mocks for every component test: NOTHING here talks to a network, a backend or a provider.
 * `@/lib/api` is replaced by an object whose every function is an inert jest.fn, so even code that tried to call an
 * API could not reach one (server rendering never runs query functions anyway).
 */
jest.mock('@/lib/api', () => {
  const group = () => new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : jest.fn(() => new Promise(() => undefined))) });
  return new Proxy({ __esModule: true, TREATMENTS_API_AVAILABLE: false }, { get: (t: any, p: string) => (p in t ? t[p] : group()) });
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'u1', fullName: 'Test Admin', role: 'clinic_admin' }, tenant: { name: 'Test Clinic', plan: 'starter', subStatus: 'trial' }, isLoading: false }) }));
jest.mock('@/components/layout/header', () => {
  const React = require('react');
  return { Header: ({ title }: { title: string }) => React.createElement('h1', null, title) };
});
jest.mock('recharts', () => {
  const React = require('react');
  const Stub = ({ children }: { children?: unknown }) => React.createElement('div', { 'data-chart': true }, children as never);
  return new Proxy({ __esModule: true }, { get: (t: any, p: string) => (p in t ? t[p] : Stub) });
});
jest.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useSearchParams: () => new URLSearchParams(), redirect: jest.fn() }));
jest.mock('next/link', () => { const React = require('react'); return { __esModule: true, default: ({ children, href }: any) => React.createElement('a', { href }, children) }; });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('use-debounce', () => ({ useDebounce: (v: unknown) => [v] }));
