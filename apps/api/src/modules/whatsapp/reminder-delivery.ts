import { WhatsappProvider, WhatsappProviderPolicy } from './whatsapp-provider.policy';

/**
 * Provider pinning + explicit, duplicate-safe failover for scheduled WhatsApp messages (24h reminder, follow-up).
 *
 * Contract
 *   1. The configured provider (WhatsappProviderPolicy.effective()) is tried FIRST and is the only one used on success.
 *   2. Failover to the other provider happens ONLY when the first one *definitively rejected* the message
 *      (an HTTP 4xx from the provider API — bad template, auth/config problem — meaning it was NOT sent).
 *   3. Anything ambiguous (timeout, network drop, 5xx, unknown error) is NOT failed over: the first provider may
 *      have delivered it, and sending through the second would risk a duplicate. The caller releases its claim and the
 *      next tick retries the SAME provider (at-least-once; see README of the scheduler for the residual risk).
 *   4. After an ambiguous failure the message is PINNED to that provider (see AmbiguityStore): later retries — including
 *      after a restart or from another instance — use only that provider and never fail over, otherwise a retry through
 *      the OTHER provider would be exactly the duplicate-delivery path rule 3 forbids.
 *   5. The caller wraps this in claimReminder → confirm/release (reminder-claim.ts), so concurrent schedulers/instances
 *      can never both be inside this function for the same appointment.
 */
export type Attempt = () => Promise<void>;
export type DeliveryPlan = Partial<Record<WhatsappProvider, Attempt>>;

/** Error carrying how far delivery got, so callers/tests can reason about it. */
export class DeliveryError extends Error {
  constructor(message: string, readonly tried: WhatsappProvider[], readonly definitive: boolean, readonly cause?: unknown) {
    super(message);
    this.name = 'DeliveryError';
  }
}

/** HTTP status from an axios error (360Dialog) or a Twilio RestException. */
export function httpStatusOf(err: any): number | undefined {
  const s = err?.response?.status ?? err?.status ?? err?.httpStatus;
  return typeof s === 'number' ? s : undefined;
}

/**
 * True only when the provider clearly refused the message with a client error, i.e. nothing was sent.
 * 408 (request timeout) and 429 (rate limited, may be partially processed) are treated as ambiguous.
 */
export function isDefinitiveRejection(err: unknown): boolean {
  const s = httpStatusOf(err);
  return s !== undefined && s >= 400 && s < 500 && s !== 408 && s !== 429;
}

/** Providers to try, in order: the effective one, then the other only if it has usable credentials. */
export function providerOrder(policy: WhatsappProviderPolicy | undefined, fallback: WhatsappProvider = 'twilio'): WhatsappProvider[] {
  if (!policy) return [fallback];                       // legacy construction: unchanged single-provider behaviour
  const first = policy.effective();
  const second: WhatsappProvider = first === 'twilio' ? '360dialog' : 'twilio';
  return policy.isConfigured(second) ? [first, second] : [first];
}

export async function deliverWithFailover(
  order: WhatsappProvider[],
  plan: DeliveryPlan,
  onFailover?: (from: WhatsappProvider, to: WhatsappProvider, err: unknown) => void,
): Promise<{ provider: WhatsappProvider }> {
  const candidates = order.filter((p) => plan[p]);
  if (!candidates.length) throw new DeliveryError('No provider can send this message', [], false);

  const tried: WhatsappProvider[] = [];
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    tried.push(provider);
    try {
      await plan[provider]!();
      return { provider };
    } catch (err) {
      lastErr = err;
      const next = candidates[i + 1];
      if (next && isDefinitiveRejection(err)) {
        onFailover?.(provider, next, err);
        continue;                                      // safe: the first provider did not send it
      }
      throw new DeliveryError((err as Error)?.message ?? 'delivery failed', tried, isDefinitiveRejection(err), err);
    }
  }
  throw new DeliveryError((lastErr as Error)?.message ?? 'delivery failed', tried, true, lastErr);
}


// ───────────────────────── ambiguity pinning ─────────────────────────

/** Remembers which provider had an AMBIGUOUS outcome for a given reminder, so retries never switch provider. */
export interface AmbiguityStore {
  get(key: string): Promise<WhatsappProvider | null>;
  set(key: string, provider: WhatsappProvider, ttlSeconds: number): Promise<void>;
}

export class InMemoryAmbiguityStore implements AmbiguityStore {
  private readonly map = new Map<string, { provider: WhatsappProvider; until: number }>();
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.until < Date.now()) { this.map.delete(key); return null; }
    return e.provider;
  }
  async set(key: string, provider: WhatsappProvider, ttlSeconds: number) {
    this.map.set(key, { provider, until: Date.now() + ttlSeconds * 1000 });
  }
}

/** Redis-backed (shared across instances, survives restarts). `cache` is the app's CacheService. */
export class CacheAmbiguityStore implements AmbiguityStore {
  constructor(private readonly cache: { get<T>(k: string): Promise<T | null>; set(k: string, v: unknown, ttl?: number): Promise<void> }) {}
  async get(key: string) {
    const v = await this.cache.get<WhatsappProvider>(key);
    return v === 'twilio' || v === '360dialog' ? v : null;
  }
  async set(key: string, provider: WhatsappProvider, ttlSeconds: number) { await this.cache.set(key, provider, ttlSeconds); }
}

let current: AmbiguityStore = new InMemoryAmbiguityStore();
/** Process-wide holder. The module binds the Redis store at startup; tests swap in an isolated store. */
export const ambiguityStore = {
  use(store: AmbiguityStore) { current = store; },
  get: (key: string) => current.get(key),
  set: (key: string, p: WhatsappProvider, ttl: number) => current.set(key, p, ttl),
};

export const AMBIGUITY_TTL_SECONDS = 36 * 3600;   // longer than any reminder window
export const ambiguityKey = (step: string, appointmentId: string) => `reminder-ambiguous:${step}:${appointmentId}`;

/**
 * Provider order for one reminder: normally [effective, other-if-configured]; once an earlier attempt was ambiguous it is
 * pinned to that provider alone (no failover) as long as that provider has an implementation in the plan.
 */
export async function orderFor(policy: WhatsappProviderPolicy | undefined, key: string, plan: DeliveryPlan): Promise<WhatsappProvider[]> {
  const pinned = await ambiguityStore.get(key);
  if (pinned && plan[pinned]) return [pinned];
  return providerOrder(policy);
}

/** Call from the failure path: an ambiguous outcome pins the reminder to the last provider that was tried. */
export async function rememberIfAmbiguous(key: string, err: unknown): Promise<void> {
  if (err instanceof DeliveryError && !err.definitive && err.tried.length) {
    await ambiguityStore.set(key, err.tried[err.tried.length - 1], AMBIGUITY_TTL_SECONDS);
  }
}
