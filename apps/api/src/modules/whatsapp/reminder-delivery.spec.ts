jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import {
  DeliveryError, deliverWithFailover, httpStatusOf, isDefinitiveRejection, providerOrder,
  ambiguityStore, InMemoryAmbiguityStore, CacheAmbiguityStore, orderFor, rememberIfAmbiguous, ambiguityKey,
} from './reminder-delivery';
import { WhatsappProviderPolicy } from './whatsapp-provider.policy';

const TWILIO = { 'twilio.accountSid': 'AC' + 'a1b2c3d4'.repeat(4), 'twilio.authToken': 'tw_token_' + 'Zx9Qm4'.repeat(3) };
const D360 = { 'whatsapp.apiKey': 'd360_key_' + 'Lp7Vn2'.repeat(3) };
const policy = (v: Record<string, string>) => new WhatsappProviderPolicy({ get: (k: string) => v[k] } as any);

describe('failure classification', () => {
  it.each([
    [{ response: { status: 400 } }, true], [{ response: { status: 401 } }, true], [{ response: { status: 404 } }, true],
    [{ response: { status: 422 } }, true], [{ status: 400 }, true], [{ httpStatus: 403 }, true],      // Twilio RestException / 360 wrapper
    [{ response: { status: 408 } }, false], [{ response: { status: 429 } }, false],                    // ambiguous
    [{ response: { status: 500 } }, false], [{ response: { status: 502 } }, false], [{ status: 503 }, false],
    [{ code: 'ECONNABORTED' }, false], [{ code: 'ETIMEDOUT' }, false], [new Error('socket hang up'), false],
    [undefined, false], [null, false], ['boom', false],
  ])('%j → definitive=%p', (err, expected) => {
    expect(isDefinitiveRejection(err)).toBe(expected);
  });
  it('httpStatusOf reads axios, Twilio and wrapped shapes', () => {
    expect(httpStatusOf({ response: { status: 422 } })).toBe(422);
    expect(httpStatusOf({ status: 400 })).toBe(400);
    expect(httpStatusOf({ httpStatus: 404 })).toBe(404);
    expect(httpStatusOf(new Error('x'))).toBeUndefined();
  });
});

describe('providerOrder', () => {
  it('no policy (legacy construction): twilio only — behaviour unchanged', () => expect(providerOrder(undefined)).toEqual(['twilio']));
  it('primary first; the other appended ONLY when it has credentials', () => {
    expect(providerOrder(policy({ ...TWILIO, ...D360 }))).toEqual(['twilio', '360dialog']);
    expect(providerOrder(policy({ ...TWILIO, ...D360, 'whatsapp.provider': '360dialog' }))).toEqual(['360dialog', 'twilio']);
    expect(providerOrder(policy({ ...TWILIO }))).toEqual(['twilio']);
    expect(providerOrder(policy({ ...D360 }))).toEqual(['360dialog']);          // primary twilio unconfigured → 360 is effective
  });
});

describe('deliverWithFailover', () => {
  const ok = () => jest.fn(async () => undefined);
  const fail = (err: unknown) => jest.fn(async () => { throw err; });

  it('uses ONLY the first provider on success (the second is never touched)', async () => {
    const a = ok(), b = ok();
    expect(await deliverWithFailover(['twilio', '360dialog'], { twilio: a, '360dialog': b })).toEqual({ provider: 'twilio' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
  it('fails over after a DEFINITIVE rejection, exactly once, and reports the callback', async () => {
    const a = fail({ response: { status: 400 } }), b = ok(), onFailover = jest.fn();
    expect(await deliverWithFailover(['twilio', '360dialog'], { twilio: a, '360dialog': b }, onFailover)).toEqual({ provider: '360dialog' });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(onFailover).toHaveBeenCalledWith('twilio', '360dialog', expect.anything());
  });
  it.each([
    ['timeout', { code: 'ECONNABORTED' }], ['network', new Error('socket hang up')], ['5xx', { response: { status: 502 } }],
    ['429', { response: { status: 429 } }], ['unknown', new Error('???')],
  ])('does NOT fail over on an ambiguous failure (%s): the first provider may already have delivered', async (_l, err) => {
    const a = fail(err), b = ok();
    await expect(deliverWithFailover(['twilio', '360dialog'], { twilio: a, '360dialog': b })).rejects.toBeInstanceOf(DeliveryError);
    expect(b).not.toHaveBeenCalled();                      // ← no duplicate risk
  });
  it('when both definitively reject, throws a definitive DeliveryError listing both', async () => {
    const e = await deliverWithFailover(['twilio', '360dialog'], { twilio: fail({ status: 400 }), '360dialog': fail({ status: 401 }) }).catch((x) => x);
    expect(e).toBeInstanceOf(DeliveryError);
    expect(e.tried).toEqual(['twilio', '360dialog']);
    expect(e.definitive).toBe(true);
  });
  it('definitive rejection with NO second provider available → throws (caller releases and retries)', async () => {
    const e = await deliverWithFailover(['twilio'], { twilio: fail({ status: 400 }) }).catch((x) => x);
    expect(e).toBeInstanceOf(DeliveryError);
    expect(e.tried).toEqual(['twilio']);
  });
  it('providers without an implementation in the plan are skipped; empty plan is an error', async () => {
    const b = ok();
    expect(await deliverWithFailover(['twilio', '360dialog'], { '360dialog': b })).toEqual({ provider: '360dialog' });
    await expect(deliverWithFailover(['twilio'], {})).rejects.toBeInstanceOf(DeliveryError);
  });
});

describe('ambiguity pinning', () => {
  beforeEach(() => ambiguityStore.use(new InMemoryAmbiguityStore()));
  const both = policy({ ...TWILIO, ...D360 });
  const plan = { twilio: async () => undefined, '360dialog': async () => undefined };
  const key = ambiguityKey('24h', 'appt-1');

  it('no pin → the normal [effective, other] order', async () => expect(await orderFor(both, key, plan)).toEqual(['twilio', '360dialog']));
  it('an ambiguous DeliveryError pins the LAST provider tried; a definitive one does not', async () => {
    await rememberIfAmbiguous(key, new DeliveryError('boom', ['twilio', '360dialog'], false));
    expect(await orderFor(both, key, plan)).toEqual(['360dialog']);
    await rememberIfAmbiguous(ambiguityKey('24h', 'appt-2'), new DeliveryError('rejected', ['twilio', '360dialog'], true));
    expect(await orderFor(both, ambiguityKey('24h', 'appt-2'), plan)).toEqual(['twilio', '360dialog']);
    await rememberIfAmbiguous(ambiguityKey('24h', 'appt-3'), new Error('not a delivery error'));
    expect(await orderFor(both, ambiguityKey('24h', 'appt-3'), plan)).toEqual(['twilio', '360dialog']);
  });
  it('a pin to a provider with no implementation in the plan is ignored (cannot strand the reminder)', async () => {
    await rememberIfAmbiguous(key, new DeliveryError('x', ['360dialog'], false));
    expect(await orderFor(both, key, { twilio: async () => undefined })).toEqual(['twilio', '360dialog']);
  });
  it('pins are keyed by step AND appointment', async () => {
    await rememberIfAmbiguous(ambiguityKey('24h', 'a'), new DeliveryError('x', ['twilio'], false));
    expect(await orderFor(both, ambiguityKey('followup', 'a'), plan)).toEqual(['twilio', '360dialog']);
    expect(await orderFor(both, ambiguityKey('24h', 'b'), plan)).toEqual(['twilio', '360dialog']);
  });
  it('the in-memory pin expires', async () => {
    const store = new InMemoryAmbiguityStore();
    await store.set('k', 'twilio', -1);
    expect(await store.get('k')).toBeNull();
  });
  it('CacheAmbiguityStore round-trips and rejects junk values', async () => {
    const mem = new Map<string, unknown>();
    const cache = { get: async (k: string) => (mem.get(k) as any) ?? null, set: async (k: string, v: unknown) => { mem.set(k, v); } };
    const store = new CacheAmbiguityStore(cache as any);
    await store.set('k', '360dialog', 60);
    expect(await store.get('k')).toBe('360dialog');
    mem.set('bad', 'carrier-pigeon');
    expect(await store.get('bad')).toBeNull();
    expect(await store.get('missing')).toBeNull();
  });
});
