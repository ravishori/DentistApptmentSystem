'use client';
import React, { useState } from 'react';
import { billingApi } from '@/lib/api';

const PAYMENT_METHODS = [
  { value: 'cash',       label: 'Cash' },
  { value: 'upi',        label: 'UPI' },
  { value: 'card',       label: 'Card' },
  { value: 'netbanking', label: 'Net Banking' },
  { value: 'cheque',     label: 'Cheque' },
  { value: 'insurance',  label: 'Insurance' },
  { value: 'other',      label: 'Other' },
];

const STATUS_BADGE: Record<string, string> = {
  draft:         'bg-slate-100 text-slate-600',
  sent:          'bg-blue-100 text-blue-700',
  partially_paid:'bg-yellow-100 text-yellow-700',
  paid:          'bg-green-100 text-green-700',
  overdue:       'bg-red-100 text-red-700',
  cancelled:     'bg-gray-100 text-gray-500',
};

interface Props {
  invoice:    any;
  onUpdated?: (inv: any) => void;
}

export function PaymentTracker({ invoice, onUpdated }: Props) {
  const [showModal,  setShowModal]  = useState(false);
  const [method,     setMethod]     = useState('cash');
  const [amount,     setAmount]     = useState('');
  const [txRef,      setTxRef]      = useState('');
  const [paidAt,     setPaidAt]     = useState('');
  const [notes,      setNotes]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');

  const balance     = Number(invoice.balanceAmount ?? (Number(invoice.totalAmount) - Number(invoice.paidAmount)));
  const paidAmount  = Number(invoice.paidAmount ?? 0);
  const totalAmount = Number(invoice.totalAmount ?? 0);
  const paidPct     = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return; }
    if (amt > balance)    { setError(`Amount exceeds balance ₹${balance.toFixed(2)}`); return; }
    setError('');
    setSubmitting(true);
    try {
      await billingApi.recordManualPayment(invoice.id, {
        amount:         amt,
        method,
        transactionRef: txRef || undefined,
        paidAt:         paidAt || undefined,
        notes:          notes || undefined,
      });
      setShowModal(false);
      setAmount(''); setTxRef(''); setPaidAt(''); setNotes('');
      onUpdated?.({ ...invoice, paidAmount: paidAmount + amt, balanceAmount: balance - amt });
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRazorpay = async () => {
    try {
      const order = await billingApi.createOrder(invoice.id);
      const rzp = new (window as any).Razorpay({
        key:      order.key,
        amount:   order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name:     'DentalEase',
        handler:  async (resp: any) => {
          await billingApi.verifyPayment({ ...resp, invoiceId: invoice.id });
          onUpdated?.({ ...invoice, status: 'paid', balanceAmount: 0, paidAmount: totalAmount });
        },
      });
      rzp.open();
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Could not initiate payment');
    }
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-slate-500 mb-1">Invoice {invoice.invoiceNumber}</p>
            <div className="flex items-center gap-2">
              <p className="text-stat tabular-nums text-slate-800">
                ₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_BADGE[invoice.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {invoice.status?.replace('_', ' ')}
              </span>
            </div>
            {invoice.dueDate && (
              <p className="text-xs text-slate-400 mt-1">Due {formatDate(invoice.dueDate)}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Balance</p>
            <p className={`text-lg font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Paid ₹{paidAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            <span>{Math.round(paidPct)}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(paidPct, 100)}%` }}
            />
          </div>
        </div>

        {/* GST breakdown */}
        {(Number(invoice.cgst) > 0 || Number(invoice.sgst) > 0) && (
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-slate-500">CGST</p>
              <p className="font-semibold text-slate-700">₹{Number(invoice.cgst).toFixed(2)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-slate-500">SGST</p>
              <p className="font-semibold text-slate-700">₹{Number(invoice.sgst).toFixed(2)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-slate-500">IGST</p>
              <p className="font-semibold text-slate-700">₹{Number(invoice.igst ?? 0).toFixed(2)}</p>
            </div>
          </div>
        )}
      </div>

      {/* Payment actions */}
      {balance > 0 && invoice.status !== 'cancelled' && (
        <div className="flex gap-3">
          <button
            onClick={() => setShowModal(true)}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
          >
            Record Manual Payment
          </button>
          <button
            onClick={handleRazorpay}
            className="flex-1 py-2.5 text-sm font-medium text-blue-600 border border-blue-200 bg-white rounded-xl hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4h16v16H4z" fillOpacity="0" />
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
            </svg>
            Pay Online
          </button>
        </div>
      )}

      {/* Payment history */}
      {invoice.payments?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Payment History</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {invoice.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      ₹{Number(p.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-slate-400">
                      {p.method?.replace('_', ' ')} · {p.paidAt ? formatDate(p.paidAt) : '—'}
                    </p>
                  </div>
                </div>
                {p.transactionRef && (
                  <p className="text-xs text-slate-400 font-mono">{p.transactionRef}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record payment modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Record Payment</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleRecord} className="px-6 py-5 space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{error}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-600">Amount (₹)</label>
                  <input
                    type="number" step="0.01" min="0.01"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder={balance.toFixed(2)}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600">Method</label>
                  <select
                    value={method} onChange={e => setMethod(e.target.value)}
                    className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Transaction Ref / Cheque No.</label>
                <input
                  value={txRef} onChange={e => setTxRef(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Payment Date</label>
                <input
                  type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Notes</label>
                <textarea
                  value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                  className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
              </div>
              <button
                type="submit" disabled={submitting}
                className="w-full py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Recording…' : 'Confirm Payment'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
