/**
 * Regression suite for the implicit-boolean-conversion trap.
 * The app-wide ValidationPipe runs with `enableImplicitConversion: true`, which turns the string "false" into `true`
 * for any boolean-typed DTO property. For consent/access flags that silently inverts the caller's intent.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IsStrictBoolean, STRICT_BOOLEAN_KEY } from './strict-boolean';
import { CreatePatientDto, UpdatePatientDto } from '../../modules/patients/dto/patient.dto';
import { CreatePaymentLinkDto } from '../../modules/billing/dto/payment-link.dto';

const IMPLICIT = { enableImplicitConversion: true };   // exactly what main.ts configures
const SRC = path.resolve(__dirname, '../..');

// Values that Boolean() would (wrongly) turn into `true`, or that are simply not booleans
const NOT_BOOLEANS: [string, unknown][] = [
  ['"false"', 'false'], ['"true"', 'true'], ['"FALSE"', 'FALSE'], ['"0"', '0'], ['"no"', 'no'], ['"off"', 'off'],
  ['"" (empty)', ''], ['1', 1], ['0', 0], ['[]', []], ['{}', {}], ['null', null],
];
// @IsOptional() deliberately treats null/undefined as "not provided", so null is only invalid for REQUIRED flags
const NOT_BOOLEANS_EXCEPT_NULL = NOT_BOOLEANS.filter(([l]) => l !== 'null');

describe('IsStrictBoolean decorator', () => {
  class Body { @IsStrictBoolean() flag!: boolean; }
  class Query { @IsStrictBoolean({ fromString: true }) flag!: boolean; }
  const errors = (cls: any, flag: unknown) => validate(plainToInstance(cls, { flag }, IMPLICIT));

  it.each([[true], [false]])('keeps the real JSON boolean %p unchanged', async (v) => {
    const dto = plainToInstance(Body, { flag: v }, IMPLICIT);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.flag).toBe(v);
  });

  it.each(NOT_BOOLEANS)('JSON body rejects %s (never coerced to true)', async (_label, v) => {
    expect((await errors(Body, v)).length).toBeGreaterThan(0);
  });

  it('missing value is rejected when required', async () => {
    expect((await validate(plainToInstance(Body, {}, IMPLICIT))).length).toBeGreaterThan(0);
  });

  describe('fromString (query strings)', () => {
    it('maps the exact strings "true"/"false" correctly — "false" is FALSE, not true', async () => {
      const t = plainToInstance(Query, { flag: 'true' }, IMPLICIT);
      const f = plainToInstance(Query, { flag: 'false' }, IMPLICIT);
      expect(await validate(t)).toHaveLength(0);
      expect(await validate(f)).toHaveLength(0);
      expect(t.flag).toBe(true);
      expect(f.flag).toBe(false);
    });
    it.each(NOT_BOOLEANS.filter(([l]) => l !== '"false"' && l !== '"true"'))('still rejects %s', async (_l, v) => {
      expect((await errors(Query, v)).length).toBeGreaterThan(0);
    });
  });
});

describe('every boolean DTO property in the API is strict (discovered, not hand-listed)', () => {
  // Load every *.dto.ts plus the controller that declares DTO classes inline
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (/\.dto\.ts$/.test(e.name) && !/\.spec\./.test(e.name)) files.push(p);
    }
  })(SRC);
  files.push(path.join(SRC, 'modules/analytics/revenue/revenue.controller.ts'));

  const { getMetadataStorage } = require('class-validator');
  const booleanProps: { cls: any; prop: string; label: string }[] = [];
  for (const f of files) {
    const mod = require(f);
    for (const [name, cls] of Object.entries<any>(mod)) {
      if (typeof cls !== 'function' || !cls.prototype) continue;
      const props = new Set<string>(getMetadataStorage().getTargetValidationMetadatas(cls, '', true, false).map((m: any) => m.propertyName));
      for (const prop of props) {
        if (Reflect.getMetadata('design:type', cls.prototype, prop) === Boolean) booleanProps.push({ cls, prop, label: `${name}.${prop}` });
      }
    }
  }

  it('discovery sanity: finds the known consent / access / notification flags', () => {
    const labels = booleanProps.map((b) => b.label);
    expect(booleanProps.length).toBeGreaterThanOrEqual(10);
    expect(labels).toEqual(expect.arrayContaining([
      'CreatePatientDto.waOptIn', 'UpdatePatientDto.waOptIn',
      'CreatePaymentLinkDto.notifySms', 'CreatePaymentLinkDto.notifyEmail', 'CreatePaymentLinkDto.acceptPartial',
      'SetRevenueAccessDto.granted', 'DashboardPreferenceDto.showOnDashboard',
    ]));
    expect(labels.some((l) => l.endsWith('.isActive'))).toBe(true);
  });

  it('none uses a plain @IsBoolean (all carry the strict marker)', () => {
    const offenders = booleanProps.filter((b) => !Reflect.getMetadata(STRICT_BOOLEAN_KEY, b.cls.prototype, b.prop)).map((b) => b.label);
    expect(offenders).toEqual([]);
  });

  it.each(booleanProps.map((b) => [b.label, b] as const))('%s: "false" can never become true; real booleans survive', async (_label, { cls, prop }) => {
    for (const [, bad] of NOT_BOOLEANS_EXCEPT_NULL) {
      const dto = plainToInstance(cls as any, { [prop]: bad }, IMPLICIT);
      const errs = (await validate(dto as object)).filter((e) => e.property === prop);
      expect(errs.length).toBeGreaterThan(0);
    }
    for (const good of [true, false]) {
      const dto = plainToInstance(cls as any, { [prop]: good }, IMPLICIT);
      const errs = (await validate(dto as object)).filter((e) => e.property === prop);
      expect(errs).toHaveLength(0);
      expect((dto as any)[prop]).toBe(good);
    }
  });
});

describe('through the real global pipe (same options as main.ts)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: IMPLICIT });
  const run = (metatype: any, body: any) => pipe.transform(body, { type: 'body', metatype } as any);
  const patient = { fullName: 'Asha Rao', phone: '+919999999999' };

  it('WhatsApp consent: waOptIn:"false" is rejected on create and update (must not opt a patient IN)', async () => {
    await expect(run(CreatePatientDto, { ...patient, waOptIn: 'false' })).rejects.toThrow(BadRequestException);
    await expect(run(UpdatePatientDto, { waOptIn: 'false' })).rejects.toThrow(BadRequestException);
  });
  it('valid JSON booleans are preserved for consent flags', async () => {
    expect(((await run(CreatePatientDto, { ...patient, waOptIn: false })) as any).waOptIn).toBe(false);
    expect(((await run(CreatePatientDto, { ...patient, waOptIn: true })) as any).waOptIn).toBe(true);
    expect(((await run(UpdatePatientDto, { waOptIn: false })) as any).waOptIn).toBe(false);
  });
  it('omitting an optional flag keeps its declared default (no accidental true)', async () => {
    const out: any = await run(CreatePaymentLinkDto, {});
    expect(out.notifySms).toBe(false);
    expect(out.notifyEmail).toBe(false);
    expect(out.acceptPartial).toBe(false);
  });
  it('payment link: notifySms:"false" / notifyEmail:"false" are rejected (must not trigger SMS/e-mail)', async () => {
    await expect(run(CreatePaymentLinkDto, { notifySms: 'false' })).rejects.toThrow(BadRequestException);
    await expect(run(CreatePaymentLinkDto, { notifyEmail: 'false' })).rejects.toThrow(BadRequestException);
  });
});
