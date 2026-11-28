import { EncryptionService } from './encryption.service';

const config = (values: Record<string, string>) => ({
  get: (key: string) => values[key],
}) as any;

describe('EncryptionService credential encryption', () => {
  const service = new EncryptionService(
    config({
      'encryption.key': 'test-encryption-key-with-at-least-32-characters',
      'app.nodeEnv': 'test',
    }),
  );

  it('encrypts credentials using the versioned format', () => {
    const encrypted = service.encryptCredential('test-api-key');

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('test-api-key');
  });

  it('decrypts versioned credentials correctly', () => {
    const encrypted = service.encryptCredential('test-api-key');

    expect(service.decryptCredential(encrypted)).toBe('test-api-key');
  });

  it('supports legacy plaintext credentials during transition', () => {
    expect(service.decryptCredential('legacy-api-key')).toBe(
      'legacy-api-key',
    );
  });

  it('rejects unsupported encrypted versions', () => {
    expect(() => service.decryptCredential('enc:v2:invalid')).toThrow();
  });

  it('rejects corrupted encrypted credentials', () => {
    const encrypted = service.encryptCredential('test-api-key');

    expect(() =>
      service.decryptCredential(`${encrypted}corrupted`),
    ).toThrow();
  });

  it('rejects empty credentials', () => {
    expect(() => service.encryptCredential('')).toThrow();
  });
});