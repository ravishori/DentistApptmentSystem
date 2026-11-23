
jest.mock(
  '../../prisma/prisma.service',
  () => ({ PrismaService: class {} }),
  { virtual: true },
);

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}));

import axios from 'axios';
import { WhatsappService } from './whatsapp.service';

describe('WhatsappService credential security', () => {
  const CLINIC_ID = 'clinic-test-001';
  const RECIPIENT = '+919999999999';
  const BASE_URL = 'https://provider.test';
  const GLOBAL_KEY = 'global_test_key_123';
  const CLINIC_KEY = 'clinic_test_key_456';
  const ENCRYPTED_KEY = 'enc:v1:mock-encrypted-payload';

  const prisma = {
    clinic: {
      findUnique: jest.fn(),
    },
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'whatsapp.baseUrl') return BASE_URL;
      if (key === 'whatsapp.apiKey') return GLOBAL_KEY;
      return undefined;
    }),
  };

  const encryption = {
    decryptCredential: jest.fn(),
  };

  const payload = {
    type: 'text',
    text: { body: 'Test message' },
  };

  const dispatch = (service: WhatsappService) =>
    (service as any).dispatch(CLINIC_ID, RECIPIENT, payload);

  const createService = (
    encryptionService?: typeof encryption,
  ) =>
    new WhatsappService(
      prisma as any,
      config as any,
      undefined,
      encryptionService as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.clinic.findUnique.mockResolvedValue({
      waApiKey: ENCRYPTED_KEY,
    });

    encryption.decryptCredential.mockReturnValue(CLINIC_KEY);

    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        messages: [{ id: 'wamid.test-123' }],
      },
    });
  });

  it('decrypts an encrypted clinic credential before dispatch', async () => {
    const service = createService(encryption);

    const result = await dispatch(service);

    expect(encryption.decryptCredential).toHaveBeenCalledWith(
      ENCRYPTED_KEY,
    );

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE_URL}/messages`,
      {
        to: RECIPIENT,
        messaging_product: 'whatsapp',
        ...payload,
      },
      {
        headers: {
          'D360-API-KEY': CLINIC_KEY,
          'Content-Type': 'application/json',
        },
      },
    );

    expect(result).toBe('wamid.test-123');
    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
  });

  it('supports legacy plaintext clinic credentials temporarily', async () => {
    prisma.clinic.findUnique.mockResolvedValue({
      waApiKey: CLINIC_KEY,
    });

    const service = createService(encryption);

    await dispatch(service);

    expect(encryption.decryptCredential).not.toHaveBeenCalled();

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE_URL}/messages`,
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'D360-API-KEY': CLINIC_KEY,
        }),
      }),
    );

    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
  });

  it('rejects corrupted encrypted credentials without sending', async () => {
    encryption.decryptCredential.mockImplementation(() => {
      throw new Error('Invalid encrypted credential payload');
    });

    const service = createService(encryption);

    await expect(dispatch(service)).rejects.toThrow(
      'Invalid encrypted credential payload',
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
  });

  it('rejects unsupported encryption versions without sending', async () => {
    prisma.clinic.findUnique.mockResolvedValue({
      waApiKey: 'enc:v2:unsupported-payload',
    });

    encryption.decryptCredential.mockImplementation(() => {
      throw new Error('Unsupported encrypted credential version');
    });

    const service = createService(encryption);

    await expect(dispatch(service)).rejects.toThrow(
      'Unsupported encrypted credential version',
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
  });

  it('fails closed when EncryptionService is unavailable', async () => {
    const service = createService(undefined);

    await expect(dispatch(service)).rejects.toThrow(
      'EncryptionService unavailable',
    );

    expect(axios.post).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
  });

  it('never falls back to the global key when clinic credential decryption fails', async () => {
    encryption.decryptCredential.mockImplementation(() => {
      throw new Error('Decryption failed');
    });

    const service = createService(encryption);

    await expect(dispatch(service)).rejects.toThrow(
      'Decryption failed',
    );

    expect(config.get).not.toHaveBeenCalledWith('whatsapp.apiKey');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('uses the global API key only when the clinic credential is absent', async () => {
    prisma.clinic.findUnique.mockResolvedValue({
      waApiKey: null,
    });

    const service = createService(encryption);

    const result = await dispatch(service);

    expect(config.get).toHaveBeenCalledWith('whatsapp.apiKey');

    expect(encryption.decryptCredential).not.toHaveBeenCalled();

    expect(axios.post).toHaveBeenCalledWith(
      `${BASE_URL}/messages`,
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'D360-API-KEY': GLOBAL_KEY,
        }),
      }),
    );

    expect(result).toBe('wamid.test-123');
  });
});
