import { Logger } from '@nestjs/common';
import { assertProductionSecrets, secretWeakness, validateEnv, REQUIRED_SECRETS } from './validate-env';

// Throwaway values generated for the test run only
const strong = (seed: string) => (seed.repeat(8) + 'Qz7!rT9vXb2LmN4pKs8WcY1dHf6JgA3e').slice(0, 48);
const GOOD = {
  JWT_SECRET: strong('aB3x'), JWT_REFRESH_SECRET: strong('Zq8w'),
  ENCRYPTION_KEY: strong('mN5t'), WHATSAPP_VERIFY_TOKEN: strong('vK9r'),
};

describe('secretWeakness', () => {
  it('accepts a long, varied secret', () => expect(secretWeakness(GOOD.JWT_SECRET)).toBeNull());

  it.each([
    [undefined, /missing/],
    ['', /missing/],
    ['short', /shorter/],
    ['a'.repeat(64), /variety/],
    [' ' + GOOD.JWT_SECRET, /whitespace/],
    ['change-me', /shorter|placeholder/],
    ['your_super_secret_jwt_key_change_this_in_production', /placeholder/],
    ['32_char_random_hex_key_here_xxxxxxxxxx', /placeholder/],
    ['ChangeMeToSomethingLongAndRandom123456789', /placeholder/],
  ])('rejects %p', (value, reason) => {
    expect(secretWeakness(value as any)).toMatch(reason);
  });
});

describe('assertProductionSecrets (fail closed)', () => {
  it('passes with four strong, distinct secrets', () => {
    expect(() => assertProductionSecrets(GOOD)).not.toThrow();
  });

  it.each([...REQUIRED_SECRETS])('aborts when %s is missing', (name) => {
    const env: any = { ...GOOD };
    delete env[name];
    expect(() => assertProductionSecrets(env)).toThrow(new RegExp(`${name} is missing`));
  });

  it.each([...REQUIRED_SECRETS])('aborts when %s is a placeholder', (name) => {
    expect(() => assertProductionSecrets({ ...GOOD, [name]: 'change-me' })).toThrow(new RegExp(name));
    expect(() => assertProductionSecrets({ ...GOOD, [name]: 'your_super_secret_jwt_key_change_this_in_production' })).toThrow(new RegExp(name));
  });

  it('aborts when a secret is too short or repetitive', () => {
    expect(() => assertProductionSecrets({ ...GOOD, JWT_SECRET: 'x'.repeat(10) })).toThrow(/JWT_SECRET/);
    expect(() => assertProductionSecrets({ ...GOOD, ENCRYPTION_KEY: 'a'.repeat(64) })).toThrow(/ENCRYPTION_KEY/);
  });

  describe('WHATSAPP_VERIFY_TOKEN', () => {
    it('is required in production', () => {
      const env: any = { ...GOOD };
      delete env.WHATSAPP_VERIFY_TOKEN;
      expect(() => assertProductionSecrets(env)).toThrow(/WHATSAPP_VERIFY_TOKEN is missing/);
    });
    it.each([
      ['the shipped code default', 'dentalease-verify'],
      ['an .env.example-style value', 'your_whatsapp_verify_token_change_me_please'],
      ['too short', 'abc123XYZ'],
    ])('rejects %s', (_label, value) => {
      expect(() => assertProductionSecrets({ ...GOOD, WHATSAPP_VERIFY_TOKEN: value })).toThrow(/WHATSAPP_VERIFY_TOKEN/);
    });
    it('must be distinct from every other secret', () => {
      for (const other of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'] as const) {
        expect(() => assertProductionSecrets({ ...GOOD, WHATSAPP_VERIFY_TOKEN: GOOD[other] })).toThrow(/must not be identical/);
      }
    });
    it('is only a warning in development (code default still lets local webhooks work)', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      expect(() => validateEnv({ NODE_ENV: 'development', WHATSAPP_VERIFY_TOKEN: 'dentalease-verify' })).not.toThrow();
      expect(String(warn.mock.calls[0][0])).not.toContain('dentalease-verify');
      warn.mockRestore();
    });
    it('a failure message never contains the token value', () => {
      const secret = 'Tok3nValueThatMustNeverAppear';
      let message = '';
      try { assertProductionSecrets({ ...GOOD, WHATSAPP_VERIFY_TOKEN: secret }); } catch (e) { message = (e as Error).message; }
      expect(message).not.toContain(secret);
    });
  });

  it('aborts when secrets are reused across purposes', () => {
    expect(() => assertProductionSecrets({ ...GOOD, JWT_REFRESH_SECRET: GOOD.JWT_SECRET })).toThrow(/must not be identical/);
    expect(() => assertProductionSecrets({ ...GOOD, ENCRYPTION_KEY: GOOD.JWT_SECRET })).toThrow(/must not be identical/);
  });

  it('reports every problem at once and never echoes a secret value', () => {
    const leaky = 'Sup3rS3cretDoNotLeak';
    let message = '';
    try {
      assertProductionSecrets({ JWT_SECRET: leaky, JWT_REFRESH_SECRET: leaky });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).toMatch(/JWT_REFRESH_SECRET/);
    expect(message).toMatch(/ENCRYPTION_KEY is missing/);
    expect(message).not.toContain(leaky);
  });
});

describe('validateEnv (wired into ConfigModule)', () => {
  it('is fatal in production', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/Refusing to start in production/);
    expect(() => validateEnv({ NODE_ENV: 'production', ...GOOD })).not.toThrow();
  });

  it('keeps local development working with placeholder values (warns, names only)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const env = { NODE_ENV: 'development', JWT_SECRET: 'change-me', ENCRYPTION_KEY: '32_char_placeholder' };
    expect(validateEnv(env)).toBe(env);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0][0]);
    expect(logged).toMatch(/JWT_SECRET/);
    expect(logged).not.toContain('change-me');
    warn.mockRestore();
  });

  it('treats an unset NODE_ENV as non-production (development default)', () => {
    expect(() => validateEnv({})).not.toThrow();
  });
});
