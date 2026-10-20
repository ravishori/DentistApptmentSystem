/**
 * AiTaggingService
 *
 * Rule-based auto-tagging for medical documents.
 * Architecture is intentionally structured so future AI providers
 * (Claude, GPT-4o Vision, AWS Textract) can be plugged in as
 * an additional enrichment step without changing the call site.
 *
 * Tag schema returned:
 *   { auto: string[], suggested: string[], confidence: number }
 */

import { Injectable, Logger } from '@nestjs/common';
import { DocumentType } from './dto/upload-document.dto';

export interface TagResult {
  auto:        string[];   // applied immediately
  suggested:   string[];   // shown in UI for user confirmation
  confidence:  number;     // 0–1 rule-match confidence
}

// ── Rule tables ────────────────────────────────────────────────────────────────

const MIME_TYPE_TAGS: Record<string, string[]> = {
  'image/jpeg':      ['image'],
  'image/png':       ['image'],
  'image/webp':      ['image'],
  'image/dicom':     ['dicom', 'xray'],
  'application/pdf': ['pdf'],
  'application/dicom': ['dicom', 'xray'],
};

const FILENAME_RULES: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /x[-_]?ray|xray|radiograph|pano|panoramic|opg|cbct|periapical|bitewing/i, tags: ['xray', 'radiology'] },
  { pattern: /scan|ct[-_]?scan|mri/i,                            tags: ['scan', 'radiology'] },
  { pattern: /report|lab|blood|cbc|hba1c|glucose|urine|culture/i, tags: ['lab', 'pathology'] },
  { pattern: /prescription|rx|medicine|drug|pharma/i,            tags: ['prescription', 'medication'] },
  { pattern: /consent|form|agreement|waiver/i,                   tags: ['consent', 'legal'] },
  { pattern: /before|after|photo|picture|img|selfie/i,           tags: ['photo', 'clinical-photo'] },
  { pattern: /invoice|bill|receipt|payment/i,                    tags: ['billing'] },
  { pattern: /implant|crown|bridge|veneer|rct|root[-_]canal/i,   tags: ['procedure'] },
  { pattern: /ortho|brace|aligner|invisalign/i,                  tags: ['orthodontics'] },
  { pattern: /child|pedo|paed/i,                                 tags: ['pediatric'] },
  { pattern: /emergency|urgent/i,                                tags: ['emergency'] },
];

const DOC_TYPE_DEFAULT_TAGS: Record<DocumentType, string[]> = {
  [DocumentType.XRAY]:         ['xray', 'radiology', 'diagnostic'],
  [DocumentType.REPORT]:       ['report', 'clinical'],
  [DocumentType.PRESCRIPTION]: ['prescription', 'medication'],
  [DocumentType.LAB_RESULT]:   ['lab', 'pathology', 'diagnostic'],
  [DocumentType.CONSENT_FORM]: ['consent', 'legal'],
  [DocumentType.PHOTO]:        ['photo', 'clinical-photo'],
  [DocumentType.OTHER]:        [],
};

@Injectable()
export class AiTaggingService {
  private readonly logger = new Logger(AiTaggingService.name);

  /**
   * Primary entry point.
   * In a future version, after basic tagging completes you can call
   * `this.enrichWithVision(file, baseTags)` for image/PDF documents.
   */
  async tag(
    fileName: string,
    mimeType: string,
    docType:  DocumentType,
    _fileBuffer?: Buffer, // reserved for future AI vision analysis
  ): Promise<TagResult> {
    const auto:      Set<string> = new Set();
    const suggested: Set<string> = new Set();
    let   hits = 0;

    // 1. Document type defaults (high confidence)
    for (const t of DOC_TYPE_DEFAULT_TAGS[docType] ?? []) auto.add(t);

    // 2. MIME type rules
    for (const t of MIME_TYPE_TAGS[mimeType.toLowerCase()] ?? []) {
      auto.add(t); hits++;
    }

    // 3. Filename pattern matching
    const name = fileName.toLowerCase().replace(/[._-]/g, ' ');
    for (const rule of FILENAME_RULES) {
      if (rule.pattern.test(name)) {
        for (const t of rule.tags) { auto.add(t); hits++; }
      }
    }

    // 4. Keyword extraction from filename (words ≥ 4 chars, not stopwords)
    const stopwords = new Set(['with', 'from', 'that', 'this', 'have', 'copy', 'file', 'scan', 'jpeg', 'png', 'pdf', 'docx']);
    const words = name
      .replace(/\.(jpg|jpeg|png|pdf|webp|dcm|dicom|tiff?|bmp)$/i, '')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !stopwords.has(w) && /^[a-z]+$/.test(w));

    for (const w of words) suggested.add(w);

    // 5. DICOM special case — always mark as diagnostic
    if (mimeType === 'application/dicom' || fileName.toLowerCase().endsWith('.dcm')) {
      auto.add('dicom');
      auto.add('diagnostic');
    }

    const confidence = Math.min(0.4 + hits * 0.15, 0.95);

    this.logger.debug(`Tagged "${fileName}": auto=${[...auto].join(',')} suggested=${[...suggested].join(',')}`);

    return {
      auto:      [...auto],
      suggested: [...suggested].filter(w => !auto.has(w)),
      confidence,
    };
  }

  /**
   * Stub for future AI Vision enrichment.
   * Plug in `@anthropic-ai/sdk` or OpenAI here.
   *
   * Example (commented out):
   *   const anthropic = new Anthropic();
   *   const response  = await anthropic.messages.create({
   *     model: 'claude-sonnet-4-6',
   *     max_tokens: 256,
   *     messages: [{ role: 'user', content: [
   *       { type: 'image', source: { type: 'base64', media_type: mimeType, data: fileBuffer.toString('base64') } },
   *       { type: 'text',  text: 'This is a dental patient document. Identify the type and list 5 relevant tags. Return JSON: { type, tags }' },
   *     ]}],
   *   });
   */
  // private async enrichWithVision(fileBuffer: Buffer, mimeType: string, baseTags: string[]): Promise<string[]> {
  //   return baseTags; // placeholder
  // }
}
