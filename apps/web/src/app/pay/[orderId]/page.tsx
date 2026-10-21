'use client';
/**
 * /pay/[orderId]
 *
 * Public-facing payment page. Two modes:
 *
 *  1. ORDER mode  — receives orderId from the API, opens Razorpay Checkout JS SDK.
 *                   Used when clinic staff initiates payment from the dashboard.
 *
 *  2. SUCCESS mode — Razorpay Payment Link redirects here after payment.
 *                   URL: /pay/success?invoice=<invoiceId>
 *                   Shows a confirmation screen.
 *
 * Razorpay Checkout SDK is loaded as a <Script> tag so Next.js doesn't
 * try to SSR it. All Razorpay operations happen client-side.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Script from 'next/script';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2, XCircle, Loader2, CreditCard, Shield, Zap,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

declare global {
  interface Window {
    Razorpay: any;
  }
}

type PageState = 'loading' | 'ready' | 'processing' | 'success' | 'failed' | 'already_paid';

interface OrderData {
  orderId:       string;
  amount:        number;       // paise
  amountDisplay: number;       // rupees
  currency:      string;
  key:           string;
  invoiceNumber: string;
  patientName:   string;
  description:   string;
}

export default function PaymentPage() {
  const params       = useParams<{ orderId: string }>();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [state, setState]     = useState<PageState>('loading');
  const [order, setOrder]     = useState<OrderData | null>(null);
  const [error, setError]     = useState('');
  const [sdkReady, setSdkReady] = useState(false);
  const rzpRef = useRef<any>(null);

  // ── Payment Link success redirect ─────────────────────────────────────────
  // Razorpay redirects to /pay/success?invoice=xxx after a Payment Link is paid
  const isSuccessPage = params.orderId === 'success';
  const invoiceId     = searchParams.get('invoice');

  // ── Load order data from API ──────────────────────────────────────────────
  useEffect(() => {
    if (isSuccessPage) {
      setState('success');
      return;
    }

    async function loadOrder() {
      try {
        // The orderId in the URL is a Razorpay order id (order_xxx).
        // We call our public resolve endpoint to get checkout parameters.
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/billing/orders/${params.orderId}/checkout`,
        );
        if (!res.ok) {
          if (res.status === 409) { setState('already_paid'); return; }
          throw new Error('Order not found');
        }
        const data = await res.json();
        setOrder(data.data);
        setState('ready');
      } catch (e: any) {
        setError(e.message ?? 'Failed to load payment');
        setState('failed');
      }
    }

    loadOrder();
  }, [params.orderId, isSuccessPage]);

  // ── Open Razorpay Checkout ────────────────────────────────────────────────
  function openCheckout() {
    if (!order || !sdkReady || !window.Razorpay) return;

    setState('processing');

    const options = {
      key:         order.key,
      amount:      order.amount,
      currency:    order.currency,
      name:        'DentalEase',
      description: order.description,
      order_id:    order.orderId,
      prefill: {
        name: order.patientName,
      },
      theme: { color: '#2563EB' },
      modal: {
        ondismiss: () => setState('ready'),
      },
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_order_id:   string;
        razorpay_signature:  string;
      }) => {
        try {
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/billing/payments/verify`,
            {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_signature:  response.razorpay_signature,
                invoiceId:           order.orderId,   // resolved server-side
              }),
            },
          );

          if (res.ok) {
            setState('success');
          } else {
            setError('Payment verification failed. Contact support if amount was deducted.');
            setState('failed');
          }
        } catch {
          setError('Network error during verification. Please contact support.');
          setState('failed');
        }
      },
    };

    rzpRef.current = new window.Razorpay(options);
    rzpRef.current.open();

    rzpRef.current.on('payment.failed', (resp: any) => {
      setError(resp.error?.description ?? 'Payment was declined. Please try again.');
      setState('failed');
    });
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  if (state === 'loading') return <PageShell><LoadingView /></PageShell>;

  if (state === 'success') return (
    <PageShell>
      <SuccessView
        invoiceNumber={order?.invoiceNumber}
        amount={order?.amountDisplay}
        onDone={() => router.push('/')}
      />
    </PageShell>
  );

  if (state === 'already_paid') return (
    <PageShell>
      <StatusView
        icon={<CheckCircle2 className="w-14 h-14 text-emerald-500" />}
        title="Already Paid"
        message="This invoice has already been settled. Thank you!"
        action={<Button onClick={() => router.push('/')}>Back to Home</Button>}
      />
    </PageShell>
  );

  if (state === 'failed') return (
    <PageShell>
      <StatusView
        icon={<XCircle className="w-14 h-14 text-red-500" />}
        title="Payment Failed"
        message={error || 'Something went wrong.'}
        action={
          <Button variant="outline" onClick={() => setState('ready')}>
            Try Again
          </Button>
        }
      />
    </PageShell>
  );

  // ── Ready / Processing ────────────────────────────────────────────────────
  return (
    <PageShell>
      {/* Load Razorpay SDK */}
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onReady={() => setSdkReady(true)}
      />

      {order && (
        <Card className="w-full max-w-sm shadow-xl border-0">
          <CardContent className="p-7 space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto">
                <CreditCard className="w-7 h-7 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Complete Payment</h1>
              <p className="text-xs text-slate-400">Powered by Razorpay</p>
            </div>

            {/* Invoice summary */}
            <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Invoice</span>
                <span className="font-semibold text-slate-800">{order.invoiceNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Patient</span>
                <span className="text-slate-700">{order.patientName}</span>
              </div>
              <div className="border-t border-slate-200 my-1" />
              <div className="flex justify-between">
                <span className="font-semibold text-slate-700">Amount Due</span>
                <span className="text-xl font-bold text-blue-600">
                  {formatCurrency(order.amountDisplay)}
                </span>
              </div>
            </div>

            {/* Pay button */}
            <Button
              className="w-full h-12 text-base"
              onClick={openCheckout}
              disabled={!sdkReady || state === 'processing'}
              loading={state === 'processing'}
            >
              {state === 'processing' ? 'Processing…' : `Pay ${formatCurrency(order.amountDisplay)}`}
            </Button>

            {/* Trust badges */}
            <div className="flex items-center justify-center gap-4 pt-1">
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Shield className="w-3 h-3" /> 256-bit SSL
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Zap className="w-3 h-3" /> Instant confirmation
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 flex flex-col items-center justify-center p-4">
      <div className="mb-6 flex items-center gap-2">
        <div className="w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="text-slate-800 font-bold text-lg">DentalEase</span>
      </div>
      {children}
    </div>
  );
}

function LoadingView() {
  return (
    <Card className="w-full max-w-sm shadow-xl border-0">
      <CardContent className="p-7 space-y-4">
        <Skeleton className="h-14 w-14 rounded-2xl mx-auto" />
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-12 rounded-xl" />
      </CardContent>
    </Card>
  );
}

function SuccessView({ invoiceNumber, amount, onDone }: {
  invoiceNumber?: string; amount?: number; onDone: () => void;
}) {
  return (
    <Card className="w-full max-w-sm shadow-xl border-0">
      <CardContent className="p-7 text-center space-y-5">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-display text-display text-foreground">Payment Successful!</h2>
          {invoiceNumber && (
            <p className="text-slate-500 text-sm mt-1">Invoice {invoiceNumber}</p>
          )}
          {amount !== undefined && (
            <p className="text-3xl font-bold text-emerald-600 mt-3">
              {formatCurrency(amount)}
            </p>
          )}
        </div>
        <p className="text-sm text-slate-500">
          A WhatsApp receipt has been sent to your registered number.
        </p>
        <Button className="w-full" onClick={onDone}>Done</Button>
      </CardContent>
    </Card>
  );
}

function StatusView({ icon, title, message, action }: {
  icon: React.ReactNode; title: string; message: string; action: React.ReactNode;
}) {
  return (
    <Card className="w-full max-w-sm shadow-xl border-0">
      <CardContent className="p-7 text-center space-y-5">
        <div className="flex justify-center">{icon}</div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <p className="text-slate-500 text-sm mt-2">{message}</p>
        </div>
        <div className="pt-1">{action}</div>
      </CardContent>
    </Card>
  );
}
