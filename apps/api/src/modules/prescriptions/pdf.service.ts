/**
 * PdfService
 *
 * Generates prescription PDFs using pdfmake (server-side, no browser required).
 * Output: Buffer — caller can stream to HTTP response or upload to S3.
 *
 * Install: npm install pdfmake @types/pdfmake
 */

import { Injectable, Logger } from '@nestjs/common';

type RxData = {
  id:         string;
  issuedAt:   Date;
  notes?:     string | null;
  patient:    { fullName: string; dateOfBirth?: Date | null; age?: number | null; gender?: string | null; phone?: string | null };
  dentist:    { fullName: string; specialization?: string | null; registrationNumber?: string | null; qualification?: string | null };
  clinic:     { name: string; address?: string | null; phone?: string | null; email?: string | null };
  items:      Array<{
    medicineName: string; dosage: string; frequency: string;
    duration: string; instructions?: string | null; quantity?: number | null;
  }>;
};

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generatePrescriptionPdf(rx: RxData): Promise<Buffer> {
    // Dynamic import — avoids module issues in NestJS DI container
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PdfPrinter = require('pdfmake');

    const fonts = {
      Roboto: {
        normal:      'node_modules/pdfmake/build/vfs_fonts.js',
        bold:        'node_modules/pdfmake/build/vfs_fonts.js',
        italics:     'node_modules/pdfmake/build/vfs_fonts.js',
        bolditalics: 'node_modules/pdfmake/build/vfs_fonts.js',
      },
    };

    // Use embedded base64 fonts from pdfmake's built-in vfs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vfsFonts = require('pdfmake/build/vfs_fonts');
    const printer  = new PdfPrinter(fonts);

    const dateStr  = new Date(rx.issuedAt).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    const medicineRows = rx.items.map((item, i) => [
      { text: `${i + 1}.`, bold: true, style: 'tableCell' },
      { text: item.medicineName, bold: true, style: 'tableCell' },
      { text: item.dosage, style: 'tableCell' },
      { text: item.frequency, style: 'tableCell' },
      { text: item.duration, style: 'tableCell' },
      { text: item.instructions ?? '—', style: 'tableCell', italics: true, color: '#666' },
    ]);

    const docDefinition: any = {
      pageSize:    'A5',
      pageMargins: [30, 30, 30, 50],

      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: 'DentalEase — Digital Prescription', style: 'footer', alignment: 'left' },
          { text: `Page ${currentPage} of ${pageCount}`, style: 'footer', alignment: 'right' },
        ],
        margin: [30, 0],
      }),

      content: [
        // ── Header ──────────────────────────────────────────────────────────
        {
          columns: [
            {
              stack: [
                { text: rx.clinic.name, style: 'clinicName' },
                { text: rx.clinic.address ?? '', style: 'clinicInfo' },
                { text: rx.clinic.phone   ?? '', style: 'clinicInfo' },
                { text: rx.clinic.email   ?? '', style: 'clinicInfo' },
              ],
            },
            {
              stack: [
                { text: `Dr. ${rx.dentist.fullName}`, style: 'dentistName', alignment: 'right' },
                { text: rx.dentist.qualification ?? '', style: 'clinicInfo', alignment: 'right' },
                { text: rx.dentist.specialization ?? '', style: 'clinicInfo', alignment: 'right' },
                ...(rx.dentist.registrationNumber
                  ? [{ text: `Reg. ${rx.dentist.registrationNumber}`, style: 'clinicInfo', alignment: 'right' }]
                  : []),
              ],
            },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 5, x2: 515, y2: 5, lineWidth: 1.5, lineColor: '#2563EB' }] },
        { text: '', margin: [0, 6] },

        // ── Patient info ─────────────────────────────────────────────────────
        {
          columns: [
            {
              stack: [
                { text: 'PATIENT', style: 'label' },
                { text: rx.patient.fullName, style: 'value', bold: true },
                {
                  text: [
                    rx.patient.age ? `Age: ${rx.patient.age}  ` : '',
                    rx.patient.gender ? `${rx.patient.gender.charAt(0).toUpperCase() + rx.patient.gender.slice(1)}` : '',
                  ],
                  style: 'value',
                },
              ],
            },
            {
              stack: [
                { text: 'DATE', style: 'label', alignment: 'right' },
                { text: dateStr, style: 'value', alignment: 'right' },
                { text: `Rx# ${rx.id.slice(-8).toUpperCase()}`, style: 'label', alignment: 'right' },
              ],
            },
          ],
        },
        { text: '', margin: [0, 8] },

        // ── Rx symbol ────────────────────────────────────────────────────────
        { text: 'Rx', style: 'rxSymbol' },
        { text: '', margin: [0, 4] },

        // ── Medicine table ───────────────────────────────────────────────────
        {
          table: {
            headerRows: 1,
            widths: [18, '*', 50, 70, 45, 70],
            body: [
              [
                { text: '#',            style: 'tableHeader' },
                { text: 'Medicine',     style: 'tableHeader' },
                { text: 'Dose',         style: 'tableHeader' },
                { text: 'Frequency',    style: 'tableHeader' },
                { text: 'Duration',     style: 'tableHeader' },
                { text: 'Instructions', style: 'tableHeader' },
              ],
              ...medicineRows,
            ],
          },
          layout: {
            hLineWidth:  (i: number) => (i === 0 || i === 1 ? 1 : 0.5),
            vLineWidth:  () => 0,
            hLineColor:  (i: number) => (i === 0 || i === 1 ? '#2563EB' : '#e2e8f0'),
            fillColor:   (rowIndex: number) => (rowIndex === 0 ? '#EFF6FF' : rowIndex % 2 === 0 ? '#F8FAFC' : null),
            paddingTop:  () => 4,
            paddingBottom: () => 4,
          },
        },

        // ── Notes ────────────────────────────────────────────────────────────
        ...(rx.notes
          ? [
              { text: '', margin: [0, 8] },
              { text: 'Clinical Notes', style: 'label' },
              { text: rx.notes, style: 'notes' },
            ]
          : []),

        // ── Signature block ──────────────────────────────────────────────────
        { text: '', margin: [0, 20] },
        {
          columns: [
            { text: '' },
            {
              stack: [
                { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 120, y2: 0, lineWidth: 1, lineColor: '#94A3B8' }] },
                { text: `Dr. ${rx.dentist.fullName}`, style: 'signature', alignment: 'center' },
                { text: 'Signature & Stamp', style: 'label', alignment: 'center' },
              ],
              width: 130,
            },
          ],
        },
      ],

      styles: {
        clinicName:  { fontSize: 13, bold: true, color: '#1e293b' },
        clinicInfo:  { fontSize: 7.5, color: '#64748b', lineHeight: 1.3 },
        dentistName: { fontSize: 11, bold: true, color: '#1e293b' },
        label:       { fontSize: 7, color: '#94A3B8', bold: true, letterSpacing: 1 },
        value:       { fontSize: 9, color: '#1e293b', lineHeight: 1.4 },
        rxSymbol:    { fontSize: 22, bold: true, color: '#2563EB', italics: true },
        tableHeader: { fontSize: 7.5, bold: true, color: '#2563EB', margin: [0, 2] },
        tableCell:   { fontSize: 8, color: '#1e293b', margin: [0, 1] },
        notes:       { fontSize: 8.5, color: '#334155', italics: true, lineHeight: 1.5 },
        signature:   { fontSize: 9, bold: true, color: '#1e293b', margin: [0, 4, 0, 0] },
        footer:      { fontSize: 7, color: '#94A3B8' },
      },

      defaultStyle: { font: 'Roboto' },
    };

    return new Promise((resolve, reject) => {
      try {
        const doc    = printer.createPdfKitDocument(docDefinition, { tableLayouts: {} });
        const chunks: Buffer[] = [];
        doc.on('data',  (c: Buffer) => chunks.push(c));
        doc.on('end',   () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}
