import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { RazorpayService } from './razorpay/razorpay.service';
import { RazorpayWebhookController } from './razorpay/razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay/razorpay-webhook.service';
import { PackagesService } from './packages.service';
import { InsuranceService } from './insurance.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [
    BillingController,
    RazorpayWebhookController,
  ],
  providers: [
    BillingService,
    RazorpayService,
    RazorpayWebhookService,
    PackagesService,
    InsuranceService,
    ReportsService,
  ],
  exports: [
    BillingService,
    RazorpayService,
    PackagesService,
    InsuranceService,
    ReportsService,
  ],
})
export class BillingModule {}
