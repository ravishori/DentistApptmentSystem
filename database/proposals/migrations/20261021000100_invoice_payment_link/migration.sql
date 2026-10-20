-- PROPOSED — NOT APPLIED. Requires owner approval.
-- Purpose: persist the Razorpay Payment Link URL on the invoice (RazorpayService.createPaymentLink
--          currently returns/emits it but cannot save it; the former write targeted a non-existent column).
-- Risk:    LOW. Additive, nullable, no default, no backfill, no lock beyond a brief ACCESS EXCLUSIVE
--          metadata change (PostgreSQL does not rewrite the table for a nullable column without default).
-- Matches: schema.prisma  Invoice.razorpayPaymentLink String? @map("razorpay_payment_link")

ALTER TABLE "invoices" ADD COLUMN "razorpay_payment_link" TEXT;
