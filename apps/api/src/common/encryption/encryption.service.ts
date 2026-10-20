import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LEN    = 16;
const TAG_LEN   = 16;

/**
 * EncryptionService — AES-256-GCM field-level encryption.
 *
 * Used for PII that needs to be searchable (store encrypted + hash index)
 * and for credentials stored in the database (wa_api_key, etc.).
 *
 * Format of encrypted value: base64(iv[16] + ciphertext + tag[16])
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key:    Buffer;

  constructor(private readonly config: ConfigService) {
    const raw = config.get<string>('encryption.key') ?? '';
    if (!raw || raw.length < 32) {
      this.logger.warn('ENCRYPTION_KEY is missing or too short — encryption will use a dev fallback');
    }
    // Key must be exactly 32 bytes for AES-256
    this.key = crypto.scryptSync(
      raw || 'dev-fallback-key-change-in-prod',
      'dentalease-salt',
      32,
    );
  }

  // ── Symmetric encryption ──────────────────────────────────────────────────

  encrypt(plaintext: string): string {
    const iv         = crypto.randomBytes(IV_LEN);
    const cipher     = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag        = cipher.getAuthTag();
    return Buffer.concat([iv, ciphertext, tag]).toString('base64');
  }

  decrypt(encrypted: string): string {
    const buf        = Buffer.from(encrypted, 'base64');
    const iv         = buf.subarray(0, IV_LEN);
    const tag        = buf.subarray(buf.length - TAG_LEN);
    const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher   = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  }

  /** Safely decrypt — returns null if decryption fails (wrong key / corrupted). */
  tryDecrypt(encrypted: string): string | null {
    try {
      return this.decrypt(encrypted);
    } catch {
      this.logger.warn('Decryption failed — returning null');
      return null;
    }
  }

  // ── One-way hashing (for searchable encrypted fields) ─────────────────────

  /** HMAC-SHA256 hash for deterministic equality search on encrypted fields. */
  hash(value: string): string {
    return crypto.createHmac('sha256', this.key).update(value).digest('hex');
  }

  // ── Password hashing helpers (delegates to bcrypt — just for co-location) ─

  /** Constant-time comparison to prevent timing attacks. */
  safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }

  // ── Secure random generation ───────────────────────────────────────────────

  /** Cryptographically-secure random token (hex, default 32 bytes = 64 hex chars). */
  randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }

  /** Short OTP-style numeric code. */
  randomOtp(digits = 6): string {
    const max = Math.pow(10, digits);
    const n   = crypto.randomInt(max);
    return String(n).padStart(digits, '0');
  }
}
