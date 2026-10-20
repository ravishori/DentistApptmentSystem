'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorState } from '@/components/ui/error-state';
import { describeApiError } from '@/lib/api-error';
import { billingApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { InvoiceBuilder } from '@/components/billing/InvoiceBuilder';
import { PaymentTracker } from '@/components/billing/PaymentTracker';
import { PackageSelector } from '@/components/billing/PackageSelector';
import { ReportsDashboard } from '@/components/billing/ReportsDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Receipt, DollarSign, Clock, CheckCircle2, X, Plus,
  Search, ChevronRight, CreditCard, Trash2, FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatCurrency } from '@/lib/utils';
import { ModalBehavior } from '@/components/ui/modal-behavior';

// ── Create Invoice Modal ──────────────────────────────────────────────────────
function CreateInvoiceModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [patientId, setPatientId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [items, setItems] = useState([{ description: '', unitPrice: '', quantity: '1' }]);
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems((i) => [...i, { description: '', unitPrice: '', quantity: '1' }]);
  const removeItem = (idx: number) => setItems((i) => i.filter((_, j) => j !== idx));
  const updateItem = (idx: number, field: string, val: string) =>
    setItems((i) => i.map((item, j) => j === idx ? { ...item, [field]: val } : item));

  const subtotal = items.reduce((sum, i) => sum + parseFloat(i.unitPrice || '0') * parseInt(i.quantity || '1', 10), 0);
  const gst = subtotal * 0.18;
  const total = subtotal + gst;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId) { toast.error('Select a patient'); return; }
    setSaving(true);
    try {
      await billingApi.createInvoice({
        patientId,
        appointmentId: appointmentId || undefined,
        items: items.map((i) => ({
          description: i.description,
          unitPrice: parseFloat(i.unitPrice),
          quantity: parseInt(i.quantity, 10),
        })),
      });
      toast.success('Invoice created');
      onSuccess();
      onClose();
    } catch {
      toast.error('Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="New Invoice" className="fixed inset-0 z-50 flex items-center justify-center p-4"><ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <Card className="relative w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">New Invoice</CardTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-ring rounded">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Patient ID *</label>
                <Input value={patientId} onChange={(e) => setPatientId(e.target.value)}
                  placeholder="patient-uuid" required />
              </div>
              <div>
                <label className="label">Appointment ID</label>
                <Input value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}
                  placeholder="appointment-uuid (optional)" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Line Items</label>
                <button type="button" onClick={addItem}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add item
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_120px_80px_32px] gap-2 items-start">
                    <Input value={item.description}
                      onChange={(e) => updateItem(idx, 'description', e.target.value)}
                      placeholder="Service description" required />
                    <Input value={item.unitPrice}
                      onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                      type="number" placeholder="Price (₹)" min="0" step="0.01" required />
                    <Input value={item.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                      type="number" placeholder="Qty" min="1" required />
                    <button type="button" onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                      className="mt-2 text-slate-300 hover:text-red-400 disabled:opacity-30 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">GST (18%)</span>
                <span className="font-medium">{formatCurrency(gst)}</span>
              </div>
              <Separator className="my-1" />
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span className="text-blue-600">{formatCurrency(total)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={saving}>Create Invoice</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Invoice Detail Drawer ─────────────────────────────────────────────────────
function InvoiceDrawer({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', invoiceId],
    queryFn: () => billingApi.findOne(invoiceId),
  });

  const createOrder = useMutation({
    mutationFn: () => billingApi.createOrder(invoiceId),
    onSuccess: (data) => {
      window.open(data.paymentUrl, '_blank');
    },
    onError: (e) => toast.error(describeApiError(e, 'Failed to create payment link')),
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Invoice Details" className="fixed inset-0 z-50 flex justify-end"><ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-slate-900">Invoice Details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring rounded">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : (
            <>
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{invoice?.invoiceNumber}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(invoice?.createdAt)}</p>
                  </div>
                  <Badge variant={statusVariant(invoice?.status)} className="capitalize">
                    {invoice?.status?.replace(/_/g, ' ')}
                  </Badge>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-slate-500">Patient</p>
                  <p className="font-semibold text-slate-900">{invoice?.patient?.fullName}</p>
                  <p className="text-xs text-slate-400">{invoice?.patient?.phone}</p>
                </div>

                {/* Line items */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Items</p>
                  <div className="space-y-1.5">
                    {invoice?.items?.map((item: any) => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-slate-700">
                          {item.description}
                          {item.quantity > 1 && <span className="text-slate-400"> ×{item.quantity}</span>}
                        </span>
                        <span className="font-medium text-slate-900">{formatCurrency(item.totalPrice)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Subtotal</span>
                    <span>{formatCurrency(invoice?.subtotal)}</span>
                  </div>
                  {invoice?.discountAmount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Discount</span>
                      <span>–{formatCurrency(invoice.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Tax</span>
                    <span>{formatCurrency(invoice?.taxAmount)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-bold">
                    <span>Total</span>
                    <span className="text-blue-600">{formatCurrency(invoice?.totalAmount)}</span>
                  </div>
                  {invoice?.paidAmount > 0 && (
                    <div className="flex justify-between text-sm text-emerald-600">
                      <span>Paid</span>
                      <span>–{formatCurrency(invoice.paidAmount)}</span>
                    </div>
                  )}
                  {invoice?.balanceAmount > 0 && (
                    <div className="flex justify-between text-sm font-semibold text-orange-600">
                      <span>Balance Due</span>
                      <span>{formatCurrency(invoice.balanceAmount)}</span>
                    </div>
                  )}
                </div>

                {(invoice?.status === 'draft' || invoice?.status === 'sent' || invoice?.status === 'partially_paid') && (
                  <Button
                    className="w-full"
                    onClick={() => createOrder.mutate()}
                    loading={createOrder.isPending}
                  >
                    <CreditCard className="w-4 h-4" />
                    {invoice.status === 'draft' ? 'Send Payment Link' : 'Pay Now'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Tab = 'invoices' | 'packages' | 'reports';

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BillingPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('invoices');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [drawerInvoiceId, setDrawerInvoiceId] = useState<string | null>(null);

  const LIMIT = 20;

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['invoices', search, statusFilter, page],
    queryFn: () => billingApi.list({
      search: search || undefined,
      status: statusFilter === 'all' ? undefined : statusFilter,
      page,
      limit: LIMIT,
    }),
  });

  const { data: stats } = useQuery({
    queryKey: ['billing-stats'],
    queryFn: billingApi.stats,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / LIMIT);

  return (
    <div>
      <Header
        title="Billing"
        subtitle="Invoices & payment tracking"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Invoice
          </Button>
        }
      />

      <div className="page-content">
        {/* Tab bar */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-2">
          {([
            { id: 'invoices',  label: 'Invoices' },
            { id: 'packages',  label: 'Packages' },
            { id: 'reports',   label: 'Reports' },
          ] as { id: Tab; label: string }[]).map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === t.id ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Packages tab */}
        {activeTab === 'packages' && (
          <Card>
            <CardContent className="p-6">
              <PackageSelector />
            </CardContent>
          </Card>
        )}

        {/* Reports tab */}
        {activeTab === 'reports' && <ReportsDashboard />}

        {/* Invoices tab */}
        {activeTab === 'invoices' && <>
        {/* Stats strip */}
        <div className={`grid grid-cols-2 gap-3 ${stats?.financialsRestricted ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}>
          {[
            // Money KPIs are removed by the API for unauthorised staff (financialsRestricted) — hide, never show ₹0
            ...(stats?.financialsRestricted ? [] : [
              { label: 'This Month', value: formatCurrency(stats?.thisMonth ?? 0), icon: DollarSign, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Outstanding', value: formatCurrency(stats?.outstanding ?? 0), icon: Clock, color: 'text-orange-600 bg-orange-50' },
            ]),
            { label: 'Paid Invoices', value: stats?.paidCount ?? 0, icon: CheckCircle2, color: 'text-blue-600 bg-blue-50' },
            { label: 'Pending', value: stats?.pendingCount ?? 0, icon: Receipt, color: 'text-purple-600 bg-purple-50' },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.color}`}>
                  <s.icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">{s.value}</p>
                  <p className="text-[11px] text-slate-400">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters + Table */}
        <Card>
          <div className="p-4 border-b border-slate-100 flex flex-wrap gap-3 items-center">
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search invoice or patient…"
              icon={<Search className="w-4 h-4" />}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partially_paid">Partial</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead className="hidden md:table-cell">Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell text-right">Balance Due</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}

              {isError && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <ErrorState title="Could not load invoices" error={error} onRetry={() => refetch()} retrying={isFetching} compact />
                  </TableCell>
                </TableRow>
              )}

              {!isLoading && !isError && (data?.items?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <FileText className="w-10 h-10 text-slate-200" />
                      <p className="text-sm font-medium">
                        {search || statusFilter !== 'all' ? 'No invoices match your filter' : 'No invoices yet'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="mt-1">
                          <Plus className="w-3.5 h-3.5" /> Create first invoice
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {data?.items?.map((inv: any) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer"
                  onClick={() => setDrawerInvoiceId(inv.id)}
                >
                  <TableCell>
                    <p className="text-sm font-semibold text-slate-800">{inv.invoiceNumber}</p>
                    <p className="text-[11px] text-slate-400">{inv.items?.length ?? 0} item{inv.items?.length !== 1 ? 's' : ''}</p>
                  </TableCell>
                  <TableCell>
                    <p className="text-sm text-slate-900">{inv.patient?.fullName}</p>
                    <p className="text-[11px] text-slate-400">{inv.patient?.phone}</p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-slate-500">
                    {formatDate(inv.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{formatCurrency(inv.totalAmount)}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(inv.status)} className="capitalize">
                      {inv.status?.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right">
                    {(inv.balanceAmount ?? 0) > 0 ? (
                      <span className="text-sm font-medium text-orange-600">
                        {formatCurrency(inv.balanceAmount)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, data?.total ?? 0)} of {data?.total} invoices
              </p>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <Button variant="outline" size="sm" disabled={page === totalPages}
                  onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
        </>}
      </div>

      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['invoices'] })}
        />
      )}

      {drawerInvoiceId && (
        <InvoiceDrawer
          invoiceId={drawerInvoiceId}
          onClose={() => setDrawerInvoiceId(null)}
        />
      )}
    </div>
  );
}
