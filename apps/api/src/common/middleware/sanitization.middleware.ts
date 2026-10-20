import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// ── Regex patterns for known injection signatures ─────────────────────────────

// SQL injection — common payloads; Prisma uses parameterized queries so this
// is defence-in-depth, not a primary control.
const SQL_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|truncate|alter|exec|execute|cast|convert|declare|xp_)\b)/i,
  /(--|;--|\/\*|\*\/|xp_|char\s*\()/i,
  /('\s*(or|and)\s*'?\d)/i,
];

// XSS — script tags, event handlers, data URIs with script
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,          // onclick=, onerror=, ...
  /data\s*:\s*text\/html/i,
  /<\s*iframe/i,
  /<\s*object/i,
  /<\s*embed/i,
];

// NoSQL injection (MongoDB-style operators in JSON)
const NOSQL_PATTERN = /\$where|\$gt|\$lt|\$ne|\$in|\$nin|\$regex/;

// Path traversal
const PATH_TRAVERSAL = /\.\.[/\\]/;

// ── Fields always allowed to contain special chars (rich-text notes, HTML from editor)
const ALLOW_HTML_FIELDS = new Set([
  'clinicalNotes', 'dentalNotes', 'notes', 'bio', 'description', 'terms',
]);

@Injectable()
export class SanitizationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (req.body && typeof req.body === 'object') {
      this.scanObject(req.body, []);
    }
    if (req.query && typeof req.query === 'object') {
      this.scanObject(req.query, []);
    }
    next();
  }

  private scanObject(obj: any, path: string[]): void {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        this.checkString(key, value, path);
      } else if (typeof value === 'object' && value !== null) {
        // Detect NoSQL injection at object level (e.g. { "$gt": "" })
        if (NOSQL_PATTERN.test(JSON.stringify(value))) {
          throw new BadRequestException(`Invalid input in field: ${[...path, key].join('.')}`);
        }
        this.scanObject(value, [...path, key]);
      }
    }
  }

  private checkString(field: string, value: string, path: string[]): void {
    const fieldPath = [...path, field].join('.');

    // Path traversal — never allowed
    if (PATH_TRAVERSAL.test(value)) {
      throw new BadRequestException(`Path traversal detected in: ${fieldPath}`);
    }

    // SQL injection check
    for (const pattern of SQL_PATTERNS) {
      if (pattern.test(value)) {
        throw new BadRequestException(`Potentially unsafe input in: ${fieldPath}`);
      }
    }

    // XSS — skip rich-text fields, block on all others
    if (!ALLOW_HTML_FIELDS.has(field)) {
      for (const pattern of XSS_PATTERNS) {
        if (pattern.test(value)) {
          throw new BadRequestException(`Script injection detected in: ${fieldPath}`);
        }
      }
    }
  }
}
