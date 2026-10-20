/**
 * DocumentsController — /v1/patients/:patientId/documents
 *
 * Routes:
 *  POST   /patients/:patientId/documents              — upload (multipart/form-data)
 *  GET    /patients/:patientId/documents              — list (paginated)
 *  GET    /patients/:patientId/documents/search       — search by type/date/keyword/tag
 *  GET    /patients/:patientId/documents/:id          — single doc with fresh presigned URL
 *  PATCH  /patients/:patientId/documents/:id          — update tags/description
 *  DELETE /patients/:patientId/documents/:id          — soft delete
 *  GET    /patients/:patientId/documents/visit/:visitId — all docs for a visit
 */

import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Res,
  ParseUUIDPipe, HttpCode, HttpStatus, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody,
} from '@nestjs/swagger';
import { DocumentsService }    from './documents.service';
import { UploadDocumentDto }   from './dto/upload-document.dto';
import { SearchDocumentsDto }  from './dto/search-documents.dto';
import { ClinicId, UserId }    from '../../common/decorators/current-user.decorator';
import { RequirePermission }   from '../../common/decorators/permissions.decorator';

@ApiTags('Documents')
@ApiBearerAuth()
@Controller({ path: 'patients/:patientId/documents', version: '1' })
export class DocumentsController {
  constructor(private readonly svc: DocumentsService) {}

  // ── Upload ─────────────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('patients:write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(), // keep in buffer; we stream to S3 directly
      limits:  { fileSize: 50 * 1024 * 1024 }, // 50 MB guard at multer level
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file:        { type: 'string', format: 'binary' },
        type:        { type: 'string', enum: ['xray','report','prescription','lab_result','consent_form','photo','other'] },
        visitId:     { type: 'string', format: 'uuid' },
        description: { type: 'string' },
        tags:        { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'type'],
    },
  })
  @ApiOperation({ summary: 'Upload a patient document to S3 (multipart/form-data)' })
  upload(
    @ClinicId()                        clinicId:  string,
    @UserId()                          userId:    string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.svc.upload(clinicId, patientId, userId, dto, file);
  }

  // ── List ───────────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'List all documents for a patient (paginated)' })
  list(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query('page')  page  = 1,
    @Query('limit') limit = 20,
  ) {
    return this.svc.findAll(clinicId, patientId, +page, +limit);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  @Get('search')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Search documents by type, date range, keyword, or tag' })
  search(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() dto: SearchDocumentsDto,
  ) {
    return this.svc.search(clinicId, patientId, dto);
  }

  // ── By visit ───────────────────────────────────────────────────────────────

  @Get('visit/:visitId')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Get all documents attached to a specific visit' })
  byVisit(
    @ClinicId()                        clinicId: string,
    @Param('visitId', ParseUUIDPipe)   visitId:  string,
  ) {
    return this.svc.findByVisit(clinicId, visitId);
  }

  // ── Single ─────────────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermission('patients:read')
  @ApiOperation({ summary: 'Get a single document with a fresh presigned URL' })
  findOne(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe)        id:        string,
  ) {
    return this.svc.findOne(clinicId, patientId, id);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermission('patients:write')
  @ApiOperation({ summary: 'Update document tags or description' })
  update(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe)        id:        string,
    @Body() body: { description?: string; tags?: string[] },
  ) {
    return this.svc.update(clinicId, patientId, id, body);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  @Delete(':id')
  @RequirePermission('patients:write')
  @ApiOperation({ summary: 'Soft-delete a document (marks isActive=false)' })
  remove(
    @ClinicId()                        clinicId:  string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe)        id:        string,
  ) {
    return this.svc.remove(clinicId, patientId, id);
  }
}
