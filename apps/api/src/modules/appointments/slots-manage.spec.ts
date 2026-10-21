/**
 * SlotsService behaviour behind the slot manager: the full-day list is clinic-scoped and validated, blocking refuses booked
 * slots, and another clinic's slot is "not found" for block and unblock. Prisma and the cache are mocked.
 */
jest.mock('../../cache/cache.service', () => ({
  CacheService: { keys: { slots: (...a: string[]) => a.join(':') } },
}), { virtual: true });
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SlotsService } from './slots.service';

const A = 'clinic-a';
const DENT = 'dentist-1';

function make() {
  const prisma: any = {
    appointmentSlot: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
  };
  const cache: any = { wrap: jest.fn((_k: string, fn: () => unknown) => fn()), del: jest.fn().mockResolvedValue(undefined) };
  return { prisma, cache, svc: new SlotsService(prisma, cache) };
}

/** The slot cache key must identify clinic, dentist and day (the key format itself is CacheService's business). */
function expectDayCacheCleared(cache: { del: jest.Mock }) {
  expect(cache.del).toHaveBeenCalledTimes(1);
  const key = String(cache.del.mock.calls[0][0]);
  for (const part of [A, DENT, '2031-03-03']) expect(key).toContain(part);
}

describe('SlotsService.listForDay', () => {
  it('queries only the caller\'s clinic, for that dentist and day, ordered by time, and is never cached', async () => {
    const { prisma, cache, svc } = make();
    const rows = [{ id: 's1', startTime: '09:00:00', isBooked: false, isBlocked: true, blockReason: 'Leave' }];
    prisma.appointmentSlot.findMany.mockResolvedValue(rows);
    await expect(svc.listForDay(A, DENT, '2031-03-03')).resolves.toBe(rows);
    const arg = prisma.appointmentSlot.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ clinicId: A, dentistId: DENT, slotDate: new Date('2031-03-03') });
    expect(arg.orderBy).toEqual({ startTime: 'asc' });
    expect(arg.where).not.toHaveProperty('isBooked');      // booked and blocked slots are included on purpose
    expect(arg.where).not.toHaveProperty('isBlocked');
    expect(cache.wrap).not.toHaveBeenCalled();
  });

  it('selects only the fields the UI needs (no patient or appointment data)', async () => {
    const { prisma, svc } = make();
    await svc.listForDay(A, DENT, '2031-03-03');
    expect(Object.keys(prisma.appointmentSlot.findMany.mock.calls[0][0].select).sort())
      .toEqual(['blockReason', 'dentistId', 'endTime', 'id', 'isBlocked', 'isBooked', 'slotDate', 'startTime']);
  });

  it.each(['', 'abc', '2031-3-3', '2031-13-45', '03/03/2031', '2031-03-03T10:00:00Z', '2031-02-31x'])('rejects the invalid date %p with 400 before touching the database', async (d) => {
    const { prisma, svc } = make();
    await expect(svc.listForDay(A, DENT, d)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appointmentSlot.findMany).not.toHaveBeenCalled();
  });
});

describe('SlotsService.getAvailable date validation', () => {
  it('rejects a malformed date with 400 instead of a database error', async () => {
    const { prisma, svc } = make();
    await expect(svc.getAvailable(A, DENT, 'nonsense')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appointmentSlot.findMany).not.toHaveBeenCalled();
  });
});

describe('SlotsService.block / unblock', () => {
  const slot = { id: 's1', dentistId: DENT, slotDate: new Date('2031-03-03'), isBooked: false, isBlocked: false };

  it('blocks a free slot with the reason and clears the day\'s slot cache', async () => {
    const { prisma, cache, svc } = make();
    prisma.appointmentSlot.findFirst.mockResolvedValue(slot);
    prisma.appointmentSlot.update.mockResolvedValue({ ...slot, isBlocked: true });
    await svc.block(A, { slotId: 's1', reason: 'Leave' });
    expect(prisma.appointmentSlot.findFirst).toHaveBeenCalledWith({ where: { id: 's1', clinicId: A } });
    expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isBlocked: true, blockReason: 'Leave' } });
    expectDayCacheCleared(cache);
  });

  it('refuses to block a booked slot (409) and changes nothing', async () => {
    const { prisma, cache, svc } = make();
    prisma.appointmentSlot.findFirst.mockResolvedValue({ ...slot, isBooked: true });
    await expect(svc.block(A, { slotId: 's1', reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.appointmentSlot.update).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('another clinic\'s (or unknown) slot is 404 for block and for unblock; nothing is written', async () => {
    const { prisma, svc } = make();
    prisma.appointmentSlot.findFirst.mockResolvedValue(null);          // the clinic filter excludes it
    await expect(svc.block('clinic-b', { slotId: 's1', reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.unblock('clinic-b', 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appointmentSlot.findFirst).toHaveBeenCalledWith({ where: { id: 's1', clinicId: 'clinic-b' } });
    expect(prisma.appointmentSlot.update).not.toHaveBeenCalled();
  });

  it('unblock clears the flag and the reason and invalidates the cache', async () => {
    const { prisma, cache, svc } = make();
    prisma.appointmentSlot.findFirst.mockResolvedValue({ ...slot, isBlocked: true });
    prisma.appointmentSlot.update.mockResolvedValue({ ...slot, isBlocked: false });
    await svc.unblock(A, 's1');
    expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { isBlocked: false, blockReason: null } });
    expectDayCacheCleared(cache);
  });
});
