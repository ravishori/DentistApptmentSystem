import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

// ── Flow names ────────────────────────────────────────────────────────────────
export type FlowName =
  | 'BOOKING'
  | 'RESCHEDULE'
  | 'CANCEL'
  | 'PAYMENT'
  | 'FOLLOWUP'
  | 'BROADCAST'
  | null;

// ── Step within a flow ────────────────────────────────────────────────────────
export type BookingStep =
  | 'SELECT_DENTIST'
  | 'SELECT_DATE'
  | 'SELECT_SLOT'
  | 'CONFIRM';

export type RescheduleStep =
  | 'SELECT_APPOINTMENT'
  | 'SELECT_DATE'
  | 'SELECT_SLOT'
  | 'CONFIRM';

export type CancelStep =
  | 'SELECT_APPOINTMENT'
  | 'CONFIRM';

export type FlowStep = BookingStep | RescheduleStep | CancelStep | string;

// ── Session data stored per phone number ─────────────────────────────────────
export interface WaSession {
  phone:      string;
  clinicId:   string;
  patientId?: string;
  flow:       FlowName;
  step:       FlowStep | null;
  data:       Record<string, any>;   // scratch-pad for flow state
  updatedAt:  number;
}

const SESSION_TTL = 30 * 60; // 30 minutes idle timeout

@Injectable()
export class WhatsappSessionService {
  private readonly logger = new Logger(WhatsappSessionService.name);
  private readonly prefix  = 'wa:session:';

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private key(phone: string): string {
    return `${this.prefix}${phone}`;
  }

  // ── Get or create ─────────────────────────────────────────────────────────

  async get(phone: string, clinicId: string): Promise<WaSession> {
    const raw = await this.redis.get(this.key(phone));
    if (raw) {
      const session: WaSession = JSON.parse(raw);
      await this.touch(phone);
      return session;
    }
    return this.reset(phone, clinicId);
  }

  // ── Persist updated session ───────────────────────────────────────────────

  async save(session: WaSession): Promise<void> {
    session.updatedAt = Date.now();
    await this.redis.setex(this.key(session.phone), SESSION_TTL, JSON.stringify(session));
  }

  // ── Set active flow + step ────────────────────────────────────────────────

  async startFlow(phone: string, clinicId: string, flow: FlowName, step: FlowStep): Promise<WaSession> {
    const session = await this.get(phone, clinicId);
    session.flow  = flow;
    session.step  = step;
    session.data  = {};
    await this.save(session);
    return session;
  }

  async advanceStep(phone: string, step: FlowStep, data?: Record<string, any>): Promise<WaSession> {
    const session = await this.get(phone, '');
    session.step  = step;
    if (data) session.data = { ...session.data, ...data };
    await this.save(session);
    return session;
  }

  async patchData(phone: string, data: Record<string, any>): Promise<void> {
    const session = await this.get(phone, '');
    session.data  = { ...session.data, ...data };
    await this.save(session);
  }

  // ── End flow ──────────────────────────────────────────────────────────────

  async reset(phone: string, clinicId: string): Promise<WaSession> {
    const session: WaSession = {
      phone,
      clinicId,
      flow:      null,
      step:      null,
      data:      {},
      updatedAt: Date.now(),
    };
    await this.save(session);
    return session;
  }

  async end(phone: string): Promise<void> {
    await this.redis.del(this.key(phone));
  }

  // ── TTL refresh ───────────────────────────────────────────────────────────

  private async touch(phone: string): Promise<void> {
    await this.redis.expire(this.key(phone), SESSION_TTL);
  }
}
