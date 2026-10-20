'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { format } from 'date-fns';
import { patientsApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Search, Plus, X, Phone, Mail, Calendar, Activity,
  FileText, Users, ChevronRight, MapPin,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, getInitials, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { ModalBehavior } from '@/components/ui/modal-behavior';

// ── Add Patient Modal ─────────────────────────────────────────────────────────
function AddPatientModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    fullName: '', phone: '', email: '', dateOfBirth: '',
    gender: 'MALE', bloodGroup: '', address: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await patientsApi.create(form);
      toast.success('Patient added successfully');
      onSuccess();
      onClose();
    } catch {
      toast.error('Failed to add patient');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Add New Patient" className="fixed inset-0 z-50 flex items-center justify-center p-4"><ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <Card className="relative w-full max-w-lg shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Add New Patient</CardTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 transition-colors focus-visible:ring-2 focus-visible:ring-ring rounded">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="label">Full Name *</label>
                <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)}
                  placeholder="Patient full name" required />
              </div>
              <div>
                <label className="label">Phone *</label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)}
                  placeholder="+91 98765 43210" required />
              </div>
              <div>
                <label className="label">Email</label>
                <Input value={form.email} onChange={(e) => set('email', e.target.value)}
                  type="email" placeholder="patient@email.com" />
              </div>
              <div>
                <label className="label">Date of Birth</label>
                <Input value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)}
                  type="date" />
              </div>
              <div>
                <label className="label">Gender</label>
                <select className="input-base w-full" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Blood Group</label>
                <select className="input-base w-full" value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
                  <option value="">Unknown</option>
                  {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                    <option key={bg} value={bg}>{bg}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Address</label>
                <Input value={form.address} onChange={(e) => set('address', e.target.value)}
                  placeholder="Street, City, State" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="flex-1" loading={saving}>Add Patient</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Patient Detail Drawer ─────────────────────────────────────────────────────
function PatientDrawer({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientsApi.findOne(patientId),
  });
  const { data: timeline } = useQuery({
    queryKey: ['patient-timeline', patientId],
    queryFn: () => patientsApi.getTimeline(patientId),
  });

  return (
    <div role="dialog" aria-modal="true" aria-label="Patient Profile" className="fixed inset-0 z-50 flex justify-end"><ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h2 className="font-semibold text-slate-900">Patient Profile</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring rounded">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : (
            <>
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-14 w-14">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-lg font-semibold">
                      {getInitials(patient?.fullName ?? '')}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-bold text-slate-900">{patient?.fullName}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{patient?.patientCode}</p>
                    {patient?.bloodGroup && (
                      <Badge variant="outline" className="text-[10px] mt-1">{patient.bloodGroup}</Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2.5 text-slate-600">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {patient?.phone}
                  </div>
                  {patient?.email && (
                    <div className="flex items-center gap-2.5 text-slate-600">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {patient.email}
                    </div>
                  )}
                  {patient?.dateOfBirth && (
                    <div className="flex items-center gap-2.5 text-slate-600">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {format(new Date(patient.dateOfBirth), 'd MMM yyyy')}
                      {patient.age ? ` · ${patient.age} yrs` : ''}
                    </div>
                  )}
                  {patient?.address && (
                    <div className="flex items-start gap-2.5 text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      {patient.address}
                    </div>
                  )}
                </div>

                <div className={`grid gap-2 ${patient?.financialsRestricted ? 'grid-cols-1' : 'grid-cols-3'}`}>
                  {[
                    { label: 'Visits', value: patient?._count?.appointments ?? 0 },
                    // Invoice count and balance are removed by the API for roles without billing access — hide, don't show 0
                    ...(patient?.financialsRestricted ? [] : [
                      { label: 'Invoices', value: patient?._count?.invoices ?? 0 },
                      { label: 'Balance', value: formatCurrency(patient?.outstandingBalance ?? 0) },
                    ]),
                  ].map((s) => (
                    <div key={s.label} className="bg-slate-50 rounded-xl p-2.5 text-center">
                      <p className="text-sm font-bold text-slate-900">{s.value}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                <Button size="sm" className="w-full" asChild>
                  <Link href={`/patients/${patientId}/ehr`}>
                    View Full Profile <ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Link>
                </Button>
              </div>

              <Separator />

              <div className="p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Activity</p>
                <div className="space-y-3">
                  {(timeline ?? []).slice(0, 8).map((event: any, i: number) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-xs text-slate-700">{event.description}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(event.date)}</p>
                      </div>
                    </div>
                  ))}
                  {!timeline?.length && (
                    <p className="text-xs text-slate-400">No activity yet</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PatientsPage() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [search] = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [drawerPatientId, setDrawerPatientId] = useState<string | null>(null);

  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['patients', search, page],
    queryFn: () => patientsApi.list({ search: search || undefined, page, limit: LIMIT }),
  });

  const { data: stats } = useQuery({
    queryKey: ['patient-stats'],
    queryFn: patientsApi.stats,
  });

  const totalPages = Math.ceil((data?.total ?? 0) / LIMIT);

  return (
    <div>
      <Header
        title="Patients"
        subtitle="CRM & patient records"
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" />
            Add Patient
          </Button>
        }
      />

      <div className="page-content">
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Patients', value: (stats?.total ?? 0).toLocaleString('en-IN'), icon: Users, color: 'text-blue-600 bg-blue-50' },
            { label: 'New This Month', value: stats?.newThisMonth ?? 0, icon: Plus, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Active (30d)', value: stats?.active ?? 0, icon: Activity, color: 'text-purple-600 bg-purple-50' },
            { label: 'Outstanding', value: stats?.financialsRestricted ? '—' : formatCurrency(stats?.totalOutstanding ?? 0), icon: FileText, color: 'text-orange-600 bg-orange-50' },
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

        {/* Table */}
        <Card>
          <div className="p-4 border-b border-slate-100">
            <Input
              value={searchInput}
              onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
              placeholder="Search by name, phone, or patient code…"
              icon={<Search className="w-4 h-4" />}
              className="max-w-sm"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead className="hidden sm:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell">Age / Gender</TableHead>
                <TableHead className="hidden lg:table-cell">Last Visit</TableHead>
                <TableHead className="hidden lg:table-cell">Balance</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}

              {!isLoading && (data?.items?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Users className="w-10 h-10 text-slate-200" />
                      <p className="text-sm font-medium">
                        {search ? `No patients matching "${search}"` : 'No patients yet'}
                      </p>
                      {!search && (
                        <Button size="sm" variant="outline" onClick={() => setShowAdd(true)} className="mt-1">
                          <Plus className="w-3.5 h-3.5" /> Add first patient
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {data?.items?.map((p: any) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => setDrawerPatientId(p.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                          {getInitials(p.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{p.fullName}</p>
                        <p className="text-[11px] text-slate-400">{p.patientCode}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <p className="text-sm text-slate-700">{p.phone}</p>
                    {p.email && <p className="text-[11px] text-slate-400">{p.email}</p>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-slate-600">
                    {p.age ? `${p.age} yrs` : '—'} · <span className="capitalize">{p.gender?.toLowerCase()}</span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-slate-500">
                    {p.lastVisitDate ? formatDate(p.lastVisitDate) : 'Never'}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {(p.outstandingBalance ?? 0) > 0 ? (
                      <Badge variant="destructive" className="text-[11px]">
                        {formatCurrency(p.outstandingBalance)}
                      </Badge>
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
                {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, data?.total ?? 0)} of {data?.total} patients
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
      </div>

      {showAdd && (
        <AddPatientModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['patients'] })}
        />
      )}

      {drawerPatientId && (
        <PatientDrawer
          patientId={drawerPatientId}
          onClose={() => setDrawerPatientId(null)}
        />
      )}
    </div>
  );
}
