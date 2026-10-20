import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';

export const NOTIFICATION_QUEUE = 'notifications';

export interface NotificationJob {
  clinicId:    string;
  userId?:     string;
  type:        string;
  title:       string;
  body:        string;
  data?:       Record<string, any>;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue<NotificationJob>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(job: NotificationJob) {
    await this.queue.add(job, {
      attempts: 3,
      backoff:  { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
    });
  }

  async findAll(clinicId: string, userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where:   { clinicId, userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { clinicId, userId } }),
      this.prisma.notification.count({ where: { clinicId, userId, readAt: null } }),
    ]);
    return { items, total, unread, page, limit };
  }

  async markRead(clinicId: string, userId: string, ids: string[]) {
    return this.prisma.notification.updateMany({
      where: { id: { in: ids }, clinicId, userId },
      data:  { readAt: new Date() },
    });
  }

  async markAllRead(clinicId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { clinicId, userId, readAt: null },
      data:  { readAt: new Date() },
    });
  }

  // ── Domain event → notification queue ────────────────────────────────────

  @OnEvent('appointment.booked')
  async onAppointmentBooked({ appointment, clinicId }: any) {
    // Notify all staff (dentist assigned + receptionist who booked)
    await this.enqueue({
      clinicId,
      userId: appointment.dentistId,
      type:   'appointment_booked',
      title:  'New Appointment',
      body:   `${appointment.patient.fullName} booked for ${appointment.startTime.slice(0, 5)}`,
      data:   { appointmentId: appointment.id },
    });
  }

  @OnEvent('appointment.cancelled')
  async onAppointmentCancelled({ appointment, clinicId }: any) {
    await this.enqueue({
      clinicId,
      userId: appointment.dentistId,
      type:   'appointment_cancelled',
      title:  'Appointment Cancelled',
      body:   `${appointment.patient.fullName}'s appointment has been cancelled`,
      data:   { appointmentId: appointment.id },
    });
  }

  @OnEvent('payment.success')
  async onPaymentSuccess({ invoiceId, clinicId }: any) {
    const invoice = await this.prisma.invoice.findUnique({
      where:   { id: invoiceId },
      include: { patient: { select: { fullName: true } } },
    });
    if (!invoice) return;

    await this.enqueue({
      clinicId,
      type:  'payment_received',
      title: 'Payment Received',
      body:  `₹${Number(invoice.totalAmount).toFixed(0)} received from ${invoice.patient.fullName}`,
      data:  { invoiceId },
    });
  }
}
