import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  traceId: string;
  userId?: string;
  clinicId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const getRequestContext = (): RequestContext | undefined => storage.getStore();
export const getRequestId = (): string | undefined => storage.getStore()?.requestId;
export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn);

/** Called once the user/tenant is known (TenantMiddleware) so later log lines carry them. */
export function setContextActor(userId?: string, clinicId?: string): void {
  const s = storage.getStore();
  if (!s) return;
  if (userId) s.userId = userId;
  if (clinicId) s.clinicId = clinicId;
}
