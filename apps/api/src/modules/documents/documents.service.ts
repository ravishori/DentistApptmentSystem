/**
 * DocumentsService
 *
 * Manages patient document records.
 * S3 is the source of truth for files; the DB stores metadata + S3 key.
 * Presigned URLs are generated fresh on every read (never stored long-term).
 */

import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService }  from '../../prisma/prisma.service';
import { S3Service }      from './s3.service';
import { AiTaggingService } from './ai-tagging.service';
import { UploadDocumentDto, DocumentType } from './dto/upload-document.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';
import { Prisma } from '@prisma/client';

// 50 MB hard cap
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/tiff',
  'application/pdf',
  'application/dicom', 'image/dicom',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly s3:        S3Service,
    private readonly aiTagger:  AiTaggingService,
  ) {}

  // ── Upload ─────────────────────────────────────────────────────────────────

  async upload(
    clinicId:   string,
    patientId:  string,
    uploaderId: string,
    dto:        UploadDocumentDto,
    file:       Express.Multer.File,
  ) {
    // Guards
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException(`File exceeds 50 MB limit (${(file.size / 1_048_576).toFixed(1)} MB)`);
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }

    await this.assertPatient(clinicId, patientId);

    if (dto.visitId) await this.assertVisit(clinicId, dto.visitId, patientId);

    // AI tagging (non-blocking — failures degrade gracefully)
    let autoTags:      string[] = [];
    let suggestedTags: string[] = [];
    try {
      const tagResult  = await this.aiTagger.tag(
        file.originalname, file.mimetype, dto.type as DocumentType, file.buffer,
      );
      autoTags      = tagResult.auto;
      suggestedTags = tagResult.suggested;
    } catch (err) {
      this.logger.warn(`AI tagging failed for ${file.originalname}: ${(err as Error).message}`);
    }

    // Merge manual + auto tags, dedupe
    const allTags = [...new Set([...(dto.tags ?? []), ...autoTags])];

    // Upload to S3
    const { s3Key, sizeBytes } = await this.s3.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
      clinicId,
      patientId,
      dto.type,
    );

    // Persist metadata
    const doc = await this.prisma.document.create({
      data: {
        clinicId,
        patientId,
        visitId:      dto.visitId,
        uploadedById: uploaderId,
        type:         dto.type as any,
        fileName:     file.originalname,
        s3Key,
        mimeType:     file.mimetype,
        sizeBytes,
        description:  dto.description,
        tags:         allTags,
        aiTags:       { auto: autoTags, suggested: suggestedTags },
      },
    });

    this.logger.log(`Document uploaded: ${doc.id} (${doc.fileName})`);

    return { ...doc, url: await this.s3.presignedGetUrl(s3Key) };
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async findAll(clinicId: string, patientId: string, page = 1, limit = 20) {
    await this.assertPatient(clinicId, patientId);

    const skip  = (page - 1) * limit;
    const where: Prisma.DocumentWhereInput = { clinicId, patientId, isActive: true };

    const [rawDocs, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { uploadedBy: { select: { fullName: true } } },
      }),
      this.prisma.document.count({ where }),
    ]);

    const docs = await this.s3.attachPresignedUrls(rawDocs);
    return { items: docs, total, page, limit };
  }

  // ── Single ─────────────────────────────────────────────────────────────────

  async findOne(clinicId: string, patientId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where:   { id, clinicId, patientId, isActive: true },
      include: { uploadedBy: { select: { fullName: true, role: true } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return { ...doc, url: await this.s3.presignedGetUrl(doc.s3Key) };
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async search(clinicId: string, patientId: string, dto: SearchDocumentsDto) {
    await this.assertPatient(clinicId, patientId);

    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;

    // Build WHERE conditions
    const conditions: Prisma.DocumentWhereInput[] = [
      { clinicId, patientId, isActive: true },
    ];

    if (dto.type)  conditions.push({ type: dto.type as any });
    if (dto.from)  conditions.push({ createdAt: { gte: new Date(dto.from) } });
    if (dto.to)    conditions.push({ createdAt: { lte: new Date(dto.to + 'T23:59:59Z') } });

    // Keyword search: filename OR description OR tags JSON contains keyword
    if (dto.q) {
      const q = dto.q.trim();
      conditions.push({
        OR: [
          { fileName:    { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          // Tags is a JSON array of strings — use raw filter
          { tags: { array_contains: q } },
        ],
      });
    }

    // Tag filter — exact tag match in JSON array
    if (dto.tag) {
      conditions.push({ tags: { array_contains: dto.tag } });
    }

    const where: Prisma.DocumentWhereInput = { AND: conditions };

    const [rawDocs, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: { uploadedBy: { select: { fullName: true } } },
      }),
      this.prisma.document.count({ where }),
    ]);

    const docs = await this.s3.attachPresignedUrls(rawDocs);
    return { items: docs, total, page, limit };
  }

  // ── Update tags / description ──────────────────────────────────────────────

  async update(clinicId: string, patientId: string, id: string, data: {
    description?: string;
    tags?:        string[];
  }) {
    await this.findOne(clinicId, patientId, id); // asserts ownership

    return this.prisma.document.update({
      where: { id },
      data: {
        description: data.description,
        tags:        data.tags,
      },
    });
  }

  // ── Soft delete ────────────────────────────────────────────────────────────

  async remove(clinicId: string, patientId: string, id: string) {
    const doc = await this.findOne(clinicId, patientId, id);

    // Soft-delete in DB; optionally schedule S3 delete
    await this.prisma.document.update({
      where: { id },
      data:  { isActive: false },
    });

    // Fire-and-forget S3 deletion (medical records: consider keeping for 7+ years)
    // Uncomment for true deletion:
    // this.s3.delete(doc.s3Key).catch(e => this.logger.warn(e));

    this.logger.log(`Document soft-deleted: ${id}`);
    return { success: true };
  }

  // ── Documents for a visit ─────────────────────────────────────────────────

  async findByVisit(clinicId: string, visitId: string) {
    const rawDocs = await this.prisma.document.findMany({
      where:   { clinicId, visitId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    return this.s3.attachPresignedUrls(rawDocs);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertPatient(clinicId: string, patientId: string) {
    const p = await this.prisma.patient.findFirst({ where: { id: patientId, clinicId } });
    if (!p) throw new NotFoundException('Patient not found');
  }

  private async assertVisit(clinicId: string, visitId: string, patientId: string) {
    const v = await this.prisma.visit.findFirst({ where: { id: visitId, clinicId, patientId } });
    if (!v) throw new NotFoundException('Visit not found');
  }
}
