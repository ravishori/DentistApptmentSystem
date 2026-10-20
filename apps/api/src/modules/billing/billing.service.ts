import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto, FilterInvoicesDto } from './dto/billing.dto';
import { RecordManualPaymentDto } from './dto/manual-payment.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class BillingService {

  constructor(
    private readonly prisma:  PrismaService,
    private readonly config:  ConfigService,
    private readonly emitter: EventEmitter2,
  ) {}

  private async nextInvoiceNumber(clinicId: string): Promise<string> {
    const year  = new Date().getFullYear();
    const count = await this.prisma.invoice.count({ where: { clinicId } });
    return `INV-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  // ── Create invoice ────────────────────────────────────────────────────────

  async create(clinicId: string, dto: CreateInvoiceDto) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: dto.patientId, clinicId },
    });
    if (!patient) throw new NotFoundException('Patient not found');

    const invoiceNumber = await this.nextInvoiceNumber(clinicId);

    // Calculate line totals and subtotal
    let subtotal = 0;
    const lines = dto.items.map((item) => {
      const lineTotal = item.quantity * item.unitPrice * (1 - (item.discountPercent ?? 0) / 100);
      subtotal += lineTotal;
      return {
        description:     item.description,
        toothNumber:     item.toothNumber,
        quantity:        item.quantity,
        unitPrice:       item.unitPrice,
        discountPercent: item.discountPercent ?? 0,
        lineTotal,
      };
    });

    const discountPercent = dto.discountPercent ?? 0;
    const discountAmount  = subtotal * discountPercent / 100;
    const taxPercent      = dto.taxPercent ?? 18;
    const taxableAmount   = subtotal - discountAmount;
    const taxAmount       = taxableAmount * taxPercent / 100;
    const totalAmount     = taxableAmount + taxAmount;
    // Split GST: CGST + SGST for intra-state; IGST for inter-state (default intra-state)
    const cgst = Math.round(taxAmount / 2 * 100) / 100;
    const sgst = Math.round((taxAmount - cgst) * 100) / 100;

    const invoice = await this.prisma.invoice.create({
      data: {
        clinicId,
        invoiceNumber,
        patientId:      dto.patientId,
        appointmentId:  dto.appointmentId,
        invoiceDate:    new Date(),
        dueDate:        dto.dueDate ? new Date(dto.dueDate) : undefined,
        subtotal,
        discountPercent,
        discountAmount,
        taxPercent,
        taxAmount,
        cgst,
        sgst,
        igst:          0,
        totalAmount,
        paidAmount:    0,
        balanceAmount: totalAmount,
        notes:         dto.notes,
        status:        'draft',
        items: { create: lines },
      },
      include: {
        items:   true,
        patient: { select: { id: true, fullName: true, phone: true } },
      },
    });

    // Update patient outstanding balance
    await this.prisma.patient.update({
      where: { id: dto.patientId },
      data:  { outstandingBalance: { increment: totalAmount } },
    });

    return invoice;
  }

  // ── List invoices ─────────────────────────────────────────────────────────

  async findAll(clinicId: string, dto: FilterInvoicesDto) {
    const { status, patientId, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.InvoiceWhereInput = {
      clinicId,
      ...(status    && { status }),
      ...(patientId && { patientId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: { patient: { select: { id: true, fullName: true, phone: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ── Single invoice ────────────────────────────────────────────────────────

  async findOne(clinicId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where:   { id, clinicId },
      include: {
        items:    true,
        patient:  { select: { id: true, fullName: true, phone: true, email: true } },
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  async stats(clinicId: string) {
    const now       = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [thisMonthRevenue, outstanding, paidCount, pendingCount] = await Promise.all([
      this.prisma.payment.aggregate({
        where:  { clinicId, status: 'success', paidAt: { gte: monthStart } },
        _sum:   { amount: true },
      }),
      this.prisma.invoice.aggregate({
        where:  { clinicId, status: { in: ['sent', 'partially_paid'] } },
        _sum:   { balanceAmount: true },
      }),
      this.prisma.invoice.count({ where: { clinicId, status: 'paid' } }),
      this.prisma.invoice.count({
        where: { clinicId, status: { in: ['draft', 'sent', 'partially_paid'] } },
      }),
    ]);

    return {
      thisMonth:    Number(thisMonthRevenue._sum.amount ?? 0),
      outstanding:  Number(outstanding._sum.balanceAmount ?? 0),
      paidCount,
      pendingCount,
    };
  }

  // ── Record manual payment ─────────────────────────────────────────────────

  async recordManualPayment(
    clinicId: string,
    invoiceId: string,
    dto: RecordManualPaymentDto,
    userId?: string,
  ) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (Number(invoice.balanceAmount) <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }
    if (dto.amount > Number(invoice.balanceAmount)) {
      throw new BadRequestException(
        `Amount ${dto.amount} exceeds balance ${invoice.balanceAmount}`,
      );
    }

    const newPaid    = Number(invoice.paidAmount) + dto.amount;
    const newBalance = Number(invoice.balanceAmount) - dto.amount;
    const newStatus  = newBalance <= 0 ? 'paid' : 'partially_paid';

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          clinicId,
          invoiceId,
          patientId:      invoice.patientId,
          amount:         dto.amount,
          method:         dto.method as any,
          status:         'success',
          transactionRef: dto.transactionRef,
          notes:          dto.notes,
          paidAt:         dto.paidAt ? new Date(dto.paidAt) : new Date(),
          recordedById:   userId,
        },
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data:  {
          paidAmount:    newPaid,
          balanceAmount: newBalance,
          status:        newStatus as any,
          ...(newStatus === 'paid' && { paidAt: new Date() }),
        },
      });

      await tx.patient.update({
        where: { id: invoice.patientId },
        data:  { outstandingBalance: { decrement: dto.amount } },
      });
    });

    this.emitter.emit('payment.manual', { invoiceId, clinicId, amount: dto.amount, method: dto.method });
    return { success: true, newBalance, status: newStatus };
  }

  // ── Cancel invoice ────────────────────────────────────────────────────────

  async cancel(clinicId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, clinicId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'paid') {
      throw new BadRequestException('Cannot cancel a paid invoice');
    }

    await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id: invoiceId },
        data:  { status: 'cancelled' },
      }),
      // Release the outstanding balance that was reserved when the invoice was created
      this.prisma.patient.update({
        where: { id: invoice.patientId },
        data:  { outstandingBalance: { decrement: Number(invoice.balanceAmount) } },
      }),
    ]);

    return { success: true };
  }
}
