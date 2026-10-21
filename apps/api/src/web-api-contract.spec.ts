/**
 * Frontend ↔ API contract guard.
 *
 * Reads every `api.<verb>('<path>')` call in apps/web/src/lib/api.ts and checks it against the controllers that are
 * actually MOUNTED in AppModule (walked through the Nest module metadata), using Express's matching rules: routes are
 * tried in declaration order and the first route with the same method and a matching path wins. A call therefore fails
 * when the method is wrong, the path does not exist, or a literal segment (e.g. "stats") would be swallowed by an
 * earlier `:id` route.
 */
jest.mock('./prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import * as fs from 'fs';
import * as path from 'path';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';

const VERB: Record<number, string> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE',
};

interface Route { verb: string; path: string; rx: RegExp }

function mountedControllers(): any[] {
  const seen = new Set<any>();
  const controllers: any[] = [];
  const visit = (m: any) => {
    const mod = m?.module ?? m;                      // dynamic modules: { module, imports }
    if (!mod || seen.has(mod) || typeof mod !== 'function') return;
    seen.add(mod);
    for (const c of Reflect.getMetadata('controllers', mod) ?? []) controllers.push(c);
    for (const c of m?.controllers ?? []) controllers.push(c);
    for (const i of [...(Reflect.getMetadata('imports', mod) ?? []), ...(m?.imports ?? [])]) visit(i);
  };
  visit(AppModule);
  return controllers;
}

function routeTable(): Route[] {
  const table: Route[] = [];
  for (const ctrl of mountedControllers()) {
    const base: string = Reflect.getMetadata('path', ctrl) ?? '';
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {        // declaration order = registration order
      const handler = ctrl.prototype[name];
      if (typeof handler !== 'function') continue;
      const method = Reflect.getMetadata('method', handler);
      if (method === undefined) continue;
      const sub: string = Reflect.getMetadata('path', handler) ?? '';
      const full = '/' + [base, sub].map((p) => p.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');
      table.push({ verb: VERB[method], path: full, rx: new RegExp('^' + full.replace(/:[A-Za-z]+/g, '[^/]+') + '$') });
    }
  }
  return table;
}

interface WebCall { verb: string; path: string }
function webCalls(): WebCall[] {
  const src = fs.readFileSync(path.resolve(__dirname, '../../web/src/lib/api.ts'), 'utf8');
  const out = new Map<string, WebCall>();
  for (const m of src.matchAll(/api\.(get|post|put|patch|delete)\(\s*([`'"])(.*?)\2/gs)) {
    const p = m[3].replace(/\$\{[^}]*\}/g, ':p').split('?')[0];
    out.set(`${m[1]} ${p}`, { verb: m[1].toUpperCase(), path: p });
  }
  return [...out.values()];
}

/** Resolve like Express: first registered route with the same method whose pattern matches. */
function resolve(table: Route[], call: WebCall): Route | undefined {
  return table.find((r) => r.verb === call.verb && r.rx.test(call.path));
}

/** A literal segment in the call must hit a literal route segment, never an earlier `:param` route. */
function shadowed(route: Route, call: WebCall): boolean {
  const a = route.path.split('/'), b = call.path.split('/');
  return a.some((seg, i) => seg.startsWith(':') && b[i] !== undefined && !b[i].startsWith(':'));
}

/** Calls that target controllers which are deliberately NOT mounted yet; the UI must not make them. */
const UNAVAILABLE_PREFIXES = ['/treatments'];

describe('apps/web/src/lib/api.ts matches the mounted API', () => {
  const table = routeTable();
  const calls = webCalls();

  it('the route table was built from the mounted modules', () => {
    expect(table.length).toBeGreaterThan(100);
    expect(table.some((r) => r.verb === 'POST' && r.path === '/appointments/:id/reschedule')).toBe(true);
    expect(table.some((r) => r.path.startsWith('/treatments') || r.path.startsWith('/users') || r.path.startsWith('/tenant'))).toBe(false);
    expect(calls.length).toBeGreaterThan(80);
  });

  const available = calls.filter((c) => !UNAVAILABLE_PREFIXES.some((p) => c.path === p || c.path.startsWith(p + '/')));
  it.each(available.map((c) => [`${c.verb} ${c.path}`, c] as const))('%s resolves to a mounted route with the same method', (_n, call) => {
    const route = resolve(table, call);
    const otherMethods = table.filter((r) => r.rx.test(call.path)).map((r) => `${r.verb} ${r.path}`);
    expect({ call: `${call.verb} ${call.path}`, found: !!route, serverHas: route ? undefined : otherMethods }).toMatchObject({ found: true });
    expect(shadowed(route!, call)).toBe(false);
  });

  it('the reported mismatches stay fixed', () => {
    const has = (verb: string, p: string) => calls.some((c) => c.verb === verb && c.path === p);
    expect(has('PUT', '/patients/:p')).toBe(false);
    expect(has('PATCH', '/patients/:p')).toBe(true);
    expect(has('PATCH', '/appointments/:p/reschedule')).toBe(false);
    expect(has('POST', '/appointments/:p/reschedule')).toBe(true);
    expect(has('PATCH', '/notifications/:p/read')).toBe(false);
    expect(has('PATCH', '/notifications/read')).toBe(true);
    expect(has('PATCH', '/appointments/slots/:p/block')).toBe(true);        // slot manager
    expect(has('PATCH', '/appointments/slots/:p/unblock')).toBe(true);
    expect(calls.some((c) => c.path.startsWith('/users'))).toBe(false);
    expect(resolve(table, { verb: 'GET', path: '/patients/stats' })?.path).toBe('/patients/stats');   // not swallowed by /patients/:id
  });

  describe('intentionally unavailable features', () => {
    const treatmentCalls = calls.filter((c) => UNAVAILABLE_PREFIXES.some((p) => c.path.startsWith(p)));
    const src = fs.readFileSync(path.resolve(__dirname, '../../web/src/lib/api.ts'), 'utf8');
    const page = fs.readFileSync(path.resolve(__dirname, '../../web/src/app/(dashboard)/treatments/page.tsx'), 'utf8');

    it('treatment calls exist only while the API does not mount them, and the flag says so', () => {
      const mounted = table.some((r) => r.path.startsWith('/treatments'));
      expect(src).toMatch(/TREATMENTS_API_AVAILABLE\s*=\s*false/);
      expect(mounted).toBe(false);                      // if this fails: mount reviewed → flip the flag and update this test
      expect(treatmentCalls.length).toBeGreaterThan(0);
    });
    it('the treatments page shows an explicit unavailable state before issuing any request', () => {
      expect(page).toContain('Treatment plans are not available yet');
      expect(page.indexOf('!TREATMENTS_API_AVAILABLE')).toBeGreaterThan(-1);
      expect(page.indexOf('!TREATMENTS_API_AVAILABLE')).toBeLessThan(page.indexOf('useQuery({'));
    });
  });
});
