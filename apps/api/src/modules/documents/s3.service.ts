/**
 * S3Service
 *
 * Wraps AWS S3 operations for patient document storage.
 * Key structure: clinics/{clinicId}/patients/{patientId}/{type}/{yyyy-mm}/{uuid}-{filename}
 * Files are stored PRIVATE; presigned GET URLs are generated on every read (1-hour TTL).
 */

import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { errText } from '../../common/observability/redaction';
import { sanitizeStack } from '../../common/observability/redaction';

export interface S3UploadResult {
  s3Key:     string;
  bucket:    string;
  eTag?:     string;
  sizeBytes: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const region    = config.get<string>('aws.region')    ?? 'ap-south-1';
    const accessKey = config.get<string>('aws.accessKey');
    const secretKey = config.get<string>('aws.secretKey');

    this.bucket = config.get<string>('aws.s3Bucket') ?? 'dentalease-documents';

    this.client = new S3Client({
      region,
      credentials: accessKey && secretKey
        ? { accessKeyId: accessKey, secretAccessKey: secretKey }
        : undefined, // falls back to IAM role / env vars when running on EC2/ECS
    });
  }

  /** Upload a file buffer. Returns the stored S3 key. */
  async upload(
    file:      Buffer,
    mimeType:  string,
    fileName:  string,
    clinicId:  string,
    patientId: string,
    docType:   string,
  ): Promise<S3UploadResult> {
    const month  = new Date().toISOString().slice(0, 7); // yyyy-mm
    const safe   = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    const s3Key  = `clinics/${clinicId}/patients/${patientId}/${docType}/${month}/${uuidv4()}-${safe}`;

    try {
      const cmd = new PutObjectCommand({
        Bucket:             this.bucket,
        Key:                s3Key,
        Body:               file,
        ContentType:        mimeType,
        ContentDisposition: `inline; filename="${safe}"`,
        ServerSideEncryption: 'AES256',
        Metadata: {
          clinicId,
          patientId,
          docType,
          originalName: fileName,
        },
      });

      const result = await this.client.send(cmd);

      this.logger.log(`Uploaded object (${file.length} bytes)`);   // the key embeds patient id + file name
      return { s3Key, bucket: this.bucket, eTag: result.ETag, sizeBytes: file.length };
    } catch (err) {
      this.logger.error(`S3 upload failed: ${errText(err)}`, sanitizeStack((err as Error).stack));
      throw new InternalServerErrorException('File upload failed');
    }
  }

  /** Generate a presigned GET URL valid for `ttlSeconds` (default 3600 = 1 h). */
  async presignedGetUrl(s3Key: string, ttlSeconds = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }

  /** Soft-check whether a key exists (useful for integrity validation). */
  async exists(s3Key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: s3Key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Permanently delete a file. Called when a document record is hard-deleted. */
  async delete(s3Key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
      this.logger.log('Deleted S3 object');
    } catch (err) {
      this.logger.warn(`S3 delete failed: ${errText(err)}`);
    }
  }

  /** Batch presign — enriches a list of documents with fresh URLs in one pass. */
  async attachPresignedUrls<T extends { s3Key: string }>(
    docs: T[],
    ttlSeconds = 3600,
  ): Promise<(T & { url: string })[]> {
    return Promise.all(
      docs.map(async (doc) => ({
        ...doc,
        url: await this.presignedGetUrl(doc.s3Key, ttlSeconds),
      })),
    );
  }
}
