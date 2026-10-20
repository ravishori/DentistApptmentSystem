-- Rollback for 20261021000100_invoice_payment_link. DESTRUCTIVE: discards stored payment-link URLs.
-- (The URLs are reproducible from Razorpay by link id = invoices.razorpay_order_id, so loss is recoverable.)
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "razorpay_payment_link";
