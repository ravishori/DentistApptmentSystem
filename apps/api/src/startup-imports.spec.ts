/**
 * Startup regression guard.
 *
 * `import X from 'cjs-pkg'` compiles to `pkg_1.default(...)`. Without `esModuleInterop` that is
 * `undefined` for CommonJS packages that do not set `.default`, so the app crashed at boot with
 * "TypeError: (0, twilio_1.default) is not a function". These tests compile with the project's real
 * tsconfig (ts-jest no longer overrides it) and exercise every default-imported CJS dependency.
 */
import dayjs from 'dayjs';
import compression from 'compression';
import Razorpay from 'razorpay';
import { Twilio } from 'twilio';
import { ServiceUnavailableException } from '@nestjs/common';
import { TwilioSenderService } from './modules/whatsapp/templates/twilio-sender.service';
import { EncryptionService } from './common/encryption/encryption.service';

const cfg = (values: Record<string, string | undefined>): any => ({ get: (k: string) => values[k] });

describe('default-imported CommonJS dependencies are callable (esModuleInterop)', () => {
  it('dayjs', () => expect(dayjs('2026-11-02').format('YYYY-MM-DD')).toBe('2026-11-02'));
  it('compression', () => expect(typeof compression()).toBe('function'));
  it('razorpay', () => expect(new Razorpay({ key_id: 'rzp_test_x', key_secret: 'y' })).toBeDefined());
  it('twilio named class export', () => {
    expect(new Twilio('AC' + 'a'.repeat(32), 'token')).toBeDefined();
  });
});

describe('TwilioSenderService startup', () => {
  const creds = { 'twilio.accountSid': 'AC' + 'a'.repeat(32), 'twilio.authToken': 'test-token', 'twilio.whatsappNumber': '+14155550100' };

  it('constructs with credentials (the original crash site)', () => {
    expect(() => new TwilioSenderService(cfg(creds))).not.toThrow();
  });

  it('still boots without credentials and fails safely only when sending', async () => {
    const svc = new TwilioSenderService(cfg({}));
    await expect(svc.sendText('+919999999999', 'hi')).rejects.toThrow(ServiceUnavailableException);
  });

  it('fromNumber throws a clear error when the sender number is missing', () => {
    expect(() => new TwilioSenderService(cfg(creds)).fromNumber).not.toThrow();
    expect(() => new TwilioSenderService(cfg({})).fromNumber).toThrow(/not configured/);
  });
});

describe('EncryptionService key handling', () => {
  const good = 'Qz7rT9vXb2LmN4pKs8WcY1dHf6JgA3eU5oIx0Bn';

  it('round-trips with a proper key', () => {
    const s = new EncryptionService(cfg({ 'encryption.key': good, 'app.nodeEnv': 'production' }));
    expect(s.decrypt(s.encrypt('patient data'))).toBe('patient data');
  });
  it('allows the dev fallback outside production', () => {
    expect(() => new EncryptionService(cfg({ 'app.nodeEnv': 'development' }))).not.toThrow();
  });
  it('refuses to start in production without a strong key', () => {
    expect(() => new EncryptionService(cfg({ 'app.nodeEnv': 'production' }))).toThrow(/ENCRYPTION_KEY/);
    expect(() => new EncryptionService(cfg({ 'encryption.key': 'short', 'app.nodeEnv': 'production' }))).toThrow(/ENCRYPTION_KEY/);
  });
  it('refuses the published .env.example placeholder in production', () => {
    const placeholder = '32_char_random_hex_key_here_xxxx';
    expect(() => new EncryptionService(cfg({ 'encryption.key': placeholder, 'app.nodeEnv': 'production' }))).toThrow(/ENCRYPTION_KEY/);
  });
});
