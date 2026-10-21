import { errText, maskPhone, redact, sanitizeStack, sanitizeText, summariseError, templatePath } from './redaction';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('sanitizeText (content scrubbing)', () => {
  it.each([
    ['JWT', `token was ${JWT} here`, JWT, '[JWT]'],
    ['Bearer header', 'header was Bearer abcdef1234567890xyz', 'abcdef1234567890xyz', 'Bearer [TOKEN]'],
    ['postgres URL', 'connect failed postgresql://dentist:S3cretPw!@db.internal:5432/dentalease_db?schema=public', 'S3cretPw', '[URL_WITH_CREDENTIALS]'],
    ['redis URL', 'redis://:hunter2@cache.internal:6379', 'hunter2', '[URL_WITH_CREDENTIALS]'],
    ['razorpay live key', 'key rzp_live_AbCdEf123456 rejected', 'rzp_live_AbCdEf123456', '[PAYMENT_KEY]'],
    ['razorpay test key', 'key rzp_test_AbCdEf123456', 'rzp_test_AbCdEf123456', '[PAYMENT_KEY]'],
    ['AWS key', 'AKIAIOSFODNN7EXAMPLE leaked', 'AKIAIOSFODNN7EXAMPLE', '[AWS_KEY]'],
    ['Twilio SID', 'sid ACa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4 invalid', 'ACa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4', '[TWILIO_SID]'],
    ['e-mail', 'patient asha.rao@example.com not found', 'asha.rao@example.com', '[EMAIL]'],
    ['phone with country code', 'sending to +91 98765 43210 failed', '98765 43210', '[PHONE]'],
    ['bare phone', 'phone 9876543210 invalid', '9876543210', '[PHONE]'],
    ['windows path', 'at C:\\Users\\dev\\project\\apps\\api\\src\\x.ts:10', 'C:\\Users\\dev', '[PATH]'],
    ['unix path', 'ENOENT /home/app/dentalease/secret.json', '/home/app/dentalease', '[PATH]'],
    ['long secret-looking token', 'key=a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6', 'a1B2c3D4e5F6a1B2c3D4e5F6a1B2c3D4e5F6', '[SECRET]'],
  ])('%s is removed', (_n, input, secret, marker) => {
    const out = sanitizeText(input);
    expect(out).not.toContain(secret);
    expect(out).toContain(marker);
  });

  it('keeps ordinary diagnostic text, UUIDs and short numbers readable', () => {
    const s = sanitizeText('Appointment 3f2a4b10-1111-4222-8333-444455556666 conflicts at slot 09:30 (status 409)');
    expect(s).toContain('3f2a4b10-1111-4222-8333-444455556666');
    expect(s).toContain('09:30');
    expect(s).toContain('409');
  });
  it('removes line breaks (no log/e-mail header injection) and truncates', () => {
    expect(sanitizeText('a\r\nBcc: attacker@evil.test\nb')).not.toMatch(/[\r\n]/);
    expect(sanitizeText('x'.repeat(1000), 50).length).toBeLessThanOrEqual(50 + '…[truncated]'.length);
  });
  it('never throws on odd inputs', () => {
    const circ: any = {}; circ.self = circ;
    for (const v of [undefined, null, 12, true, circ, Symbol('x'), () => 1, 10n]) expect(() => sanitizeText(v as any)).not.toThrow();
  });
});

describe('redact (key-based + deep)', () => {
  it('replaces secret and personal-data keys wholesale, whatever the value', () => {
    const out = redact({
      password: 'p', newPassword: 'p', token: 't', refreshToken: 'r', authorization: 'Bearer x', cookie: 'c', apiKey: 'k', secret: 's',
      cardNumber: '4111', cvv: '123', signature: 'sig', DATABASE_URL: 'postgres://x', smtpPass: 'pw',
      fullName: 'Asha Rao', email: 'a@b.co', phone: '+919876543210', dateOfBirth: '1990-01-01', address: '1 Main St', allergies: 'penicillin',
      clinicalNotes: 'root canal', medicalHistory: 'diabetes', chiefComplaint: 'pain', body: { x: 1 }, notes: 'n',
    }) as Record<string, unknown>;
    for (const [k, v] of Object.entries(out)) expect([k, v]).toEqual([k, '[REDACTED]']);
  });
  it('keeps operational fields, including the error name', () => {
    const out = redact({ status: 500, route: '/api/v1/patients/:id', name: 'PrismaClientKnownRequestError', code: 'P2002', durationMs: 12, requestId: 'req-abc' }) as any;
    expect(out).toEqual({ status: 500, route: '/api/v1/patients/:id', name: 'PrismaClientKnownRequestError', code: 'P2002', durationMs: 12, requestId: 'req-abc' });
  });
  it('recurses, scrubs nested strings and bounds depth, width and array size', () => {
    const deep = { a: { b: { c: { d: { e: { f: 'x' } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[MaxDepth]');
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(redact(wide) as object).length).toBeLessThanOrEqual(41);
    expect((redact(Array.from({ length: 100 }, (_, i) => i)) as unknown[]).length).toBe(21);
    expect(JSON.stringify(redact({ msg: `see ${JWT}` }))).not.toContain(JWT);
    expect(JSON.stringify(redact({ list: [{ password: 'x', ok: 1 }] }))).toBe('{"list":[{"password":"[REDACTED]","ok":1}]}');
  });
  it('handles cycles, errors, dates, buffers and does not mutate its input', () => {
    const o: any = { n: 1, nested: { password: 'keep-original' } }; o.self = o;
    const out = redact(o) as any;
    expect(out.self).toBe('[Circular]');
    expect(o.nested.password).toBe('keep-original');
    expect(redact(new Error('boom user@x.co'))).toEqual({ name: 'Error', message: 'boom [EMAIL]' });
    expect(redact(new Date('2031-01-02T03:04:05Z'))).toBe('2031-01-02T03:04:05.000Z');
    expect(redact(Buffer.from('abc'))).toBe('[Buffer 3b]');
  });
});

describe('summariseError / sanitizeStack / templatePath', () => {
  it('summarises system errors with their scrubbed message; everything else keeps only name + code', () => {
    const e = Object.assign(new Error('failed for a@b.co'), { code: 'ECONNREFUSED' });
    expect(summariseError(e)).toEqual({ name: 'Error', code: 'ECONNREFUSED', message: 'failed for [EMAIL]' });
    expect(summariseError('plain string')).toEqual({ name: 'string', messageOmitted: true });
    expect(summariseError(null)).toEqual({ name: 'object', messageOmitted: true });
  });
  it('FREE-FORM EXCEPTION MESSAGES ARE OMITTED: a patient name inside a message never reaches a log', () => {
    const leaky = [
      new Error('Appointment conflict for patient Asha Rao Kulkarni at 10:00'),
      Object.assign(new Error('Unique constraint failed on (`phone`) for Asha Rao +919876543210'), { name: 'PrismaClientKnownRequestError', code: 'P2002' }),
      new SyntaxError(`Unexpected token 'A', "Asha Rao Kulkarni" is not valid JSON`),
      Object.assign(new Error('Twilio: cannot message Asha Rao'), { code: 20003 }),
    ];
    for (const e of leaky) {
      const s = summariseError(e);
      expect(JSON.stringify(s)).not.toMatch(/Asha|Kulkarni|9198765/);
      expect(s.messageOmitted).toBe(true);
      expect(s.message).toBeUndefined();
      expect(errText(e)).not.toMatch(/Asha|Kulkarni/);
    }
    expect(summariseError(leaky[1])).toEqual({ name: 'PrismaClientKnownRequestError', code: 'P2002', messageOmitted: true });
  });
  it('engine errors keep their (value-free) message so bugs stay diagnosable', () => {
    expect(summariseError(new TypeError("Cannot read properties of undefined (reading 'fullName')")).message).toContain("reading 'fullName'");
    expect(errText(new ReferenceError('x is not defined'))).toBe('ReferenceError: x is not defined');
    expect(errText(Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:6379'), { code: 'ECONNREFUSED' }))).toContain('ECONNREFUSED');
  });
  it('LOG_ERROR_MESSAGES=full opts in to SCRUBBED messages for local debugging only', () => {
    process.env.LOG_ERROR_MESSAGES = 'full';
    try {
      const s = summariseError(new Error('bad value for a@b.co and postgresql://u:pw@h/d'));
      expect(s.message).toBe('bad value for [EMAIL] and [URL_WITH_CREDENTIALS]');
    } finally { delete process.env.LOG_ERROR_MESSAGES; }
  });
  it('errText never throws and masks phones to the last two digits', () => {
    expect(() => errText(undefined)).not.toThrow();
    expect(maskPhone('+91 98765 43210')).toBe('••••10');
    expect(maskPhone('12')).toBe('[PHONE]');
    expect(maskPhone(undefined)).toBe('[PHONE]');
    expect(maskPhone('+919876543210')).not.toContain('98765');
  });
  it('limits stack depth and scrubs paths', () => {
    const stack = ['Error: x', ...Array.from({ length: 30 }, (_, i) => `    at fn${i} (C:\\Users\\dev\\proj\\src\\f${i}.ts:1:1)`)].join('\n');
    const out = sanitizeStack(stack, 5)!;
    expect(out.split('\n')).toHaveLength(6);
    expect(out).not.toContain('C:\\Users');
    expect(sanitizeStack(undefined)).toBeUndefined();
  });
  it('turns ids into placeholders so routes are low-cardinality and carry no identifiers', () => {
    expect(templatePath('/api/v1/patients/3f2a4b10-1111-4222-8333-444455556666/documents?token=abc')).toBe('/api/v1/patients/:id/documents');
    expect(templatePath('/api/v1/billing/orders/order_N8sd7f6s8d7f6sd8f7s6df/checkout')).toBe('/api/v1/billing/orders/:token/checkout');
    expect(templatePath('/api/v1/x/123456')).toBe('/api/v1/x/:n');
    expect(templatePath(undefined)).toBe('');
  });
});
