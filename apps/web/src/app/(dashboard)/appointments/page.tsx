'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  format, addDays, subDays, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, parseISO, addWeeks, subWeeks,
} from 'date-fns';
import { ErrorState } from '@/components/ui/error-state';
import { describeApiError } from '@/lib/api-error';
import { appointmentsApi } from '@/lib/api';
import { Header } from '@/components/layout/header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Calendar, ChevronLeft, ChevronRight, Plus, Search,
  LayoutList, LayoutGrid, Clock, User, Stethoscope, MoreHorizontal, CalendarClock, Ban,
} from 'lucide-react';
import { toast } from 'sonner';
import { BookAppointmentModal } from '@/components/appointments/book-modal';
import { CancelAppointmentDialog } from '@/components/appointments/cancel-dialog';
import { RescheduleAppointmentDialog } from '@/components/appointments/reschedule-dialog';
import { SlotManagerDialog } from '@/components/appointments/slot-manager';
import { useAuth } from '@/lib/auth';
import { canCancelAppointment, canManageSlots, canRescheduleAppointment } from '@/lib/appointment-rules';
import { cn, formatDentist } from '@/lib/utils';

// ── Status color helpers ──────────────────────────────────────────────────────
const STATUS_BG: Record<string, string> = {
  scheduled:   'bg-blue-100 border-blue-300 text-blue-800',
  confirmed:   'bg-emerald-100 border-emerald-300 text-emerald-800',
  in_progress: 'bg-amber-100 border-amber-300 text-amber-800',
  completed:   'bg-slate-100 border-slate-300 text-slate-600',
  cancelled:   'bg-red-100 border-red-200 text-red-700',
  no_show:     'bg-orange-100 border-orange-200 text-orange-700',
};

// ── Week Calendar ─────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 11 }, (_, i) => i + 8); // 8 – 18

function WeekCalendar({
  appointments,
  weekStart,
  onSelectAppt,
}: {
  appointments: any[];
  weekStart: Date;
  onSelectAppt: (a: any) => void;
}) {
  const days = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(weekStart, { weekStartsOn: 1 }),
  });

  const apptFor = (day: Date, hour: number) =>
    appointments.filter((a) => {
      const d = parseISO(a.date);
      const h = parseInt(a.startTime?.slice(0, 2) ?? '0', 10);
      return isSameDay(d, day) && h === hour;
    });

  return (
    <div className="overflow-auto">
      <div className="min-w-[700px]">
        {/* Day headers */}
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-200">
          <div />
          {days.map((day) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className="py-2 text-center">
                <p className="text-[10px] font-medium text-slate-400 uppercase">
                  {format(day, 'EEE')}
                </p>
                <div className={cn(
                  'mx-auto mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold',
                  isToday ? 'bg-blue-600 text-white' : 'text-slate-700',
                )}>
                  {format(day, 'd')}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hour rows */}
        {HOURS.map((hour) => (
          <div key={hour} className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-slate-100 min-h-[64px]">
            <div className="py-2 pr-2 text-right">
              <span className="text-[10px] text-slate-400">{hour}:00</span>
            </div>
            {days.map((day) => {
              const slots = apptFor(day, hour);
              return (
                <div key={day.toISOString()} className="border-l border-slate-100 p-0.5 space-y-0.5">
                  {slots.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onSelectAppt(a)}
                      className={cn(
                        'w-full text-left px-1.5 py-1 rounded text-[10px] font-medium border truncate leading-tight',
                        STATUS_BG[a.status] ?? 'bg-slate-100 border-slate-200 text-slate-600',
                      )}
                    >
                      <span className="block font-semibold truncate">{a.patient?.fullName}</span>
                      <span className="opacity-70">{a.startTime?.slice(0, 5)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Appointment detail mini-panel ─────────────────────────────────────────────
function ApptDetailPanel({
  appt,
  onClose,
  onStatusChange,
  onCancel,
  onReschedule,
}: {
  appt: any;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
  onCancel: (appt: any) => void;
  onReschedule: (appt: any) => void;
}) {
  if (!appt) return null;
  return (
    <Card className="absolute right-4 top-16 w-72 z-20 shadow-xl border-slate-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <p className="font-semibold text-slate-900">{appt.patient?.fullName}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
        </div>
        <div className="space-y-1.5 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            {appt.startTime?.slice(0, 5)} – {appt.endTime?.slice(0, 5)}
          </div>
          <div className="flex items-center gap-2">
            <Stethoscope className="w-3.5 h-3.5 text-slate-400" />
            {formatDentist(appt.dentist?.fullName)}
          </div>
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-slate-400" />
            {appt.type?.replace(/_/g, ' ')}
          </div>
        </div>
        <StatusBadge status={appt.status} />
        <div className="pt-1 flex flex-wrap gap-2">
          {appt.status === 'scheduled' && (
            <Button size="sm" className="h-8 flex-1 text-xs" onClick={() => onStatusChange(appt.id, 'in_progress')}>
              Start
            </Button>
          )}
          {appt.status === 'in_progress' && (
            <Button size="sm" variant="success" className="h-8 w-full text-xs" onClick={() => onStatusChange(appt.id, 'completed')}>
              Mark Completed
            </Button>
          )}
          {canRescheduleAppointment(appt.status) && (
            <Button size="sm" variant="outline" className="h-8 flex-1 text-xs" onClick={() => onReschedule(appt)}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Reschedule
            </Button>
          )}
          {canCancelAppointment(appt.status) && (
            <Button size="sm" variant="destructive" className="h-8 flex-1 text-xs" onClick={() => onCancel(appt)}>
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
/** Row actions for an appointment (always visible: no hover-only controls). Cancel and reschedule open confirmation dialogs. */
function ApptActions({ appt, onStatus, onCancel, onReschedule }: {
  appt: any;
  onStatus: (id: string, status: string) => void;
  onCancel: (appt: any) => void;
  onReschedule: (appt: any) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {appt.status === 'scheduled' && (
        <Button size="sm" className="h-8 px-2.5 text-xs" onClick={() => onStatus(appt.id, 'in_progress')}>Start</Button>
      )}
      {appt.status === 'in_progress' && (
        <Button size="sm" variant="success" className="h-8 px-2.5 text-xs" onClick={() => onStatus(appt.id, 'completed')}>Complete</Button>
      )}
      {canRescheduleAppointment(appt.status) && (
        <Button size="sm" variant="outline" className="h-8 px-2.5 text-xs" onClick={() => onReschedule(appt)} aria-label={`Reschedule ${appt.patient?.fullName ?? 'appointment'}`}>Reschedule</Button>
      )}
      {canCancelAppointment(appt.status) && (
        <Button size="sm" variant="outline" className="h-8 border-destructive/40 px-2.5 text-xs text-destructive" onClick={() => onCancel(appt)} aria-label={`Cancel ${appt.patient?.fullName ?? 'appointment'}`}>Cancel</Button>
      )}
    </div>
  );
}

export default function AppointmentsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'week'>('list');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weekStart, setWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showBook, setShowBook] = useState(false);
  const [selectedAppt, setSelectedAppt] = useState<any>(null);
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<any>(null);
  const [showSlots, setShowSlots] = useState(false);
  const { user } = useAuth();
  const slotManager = canManageSlots(user?.role);
  const openCancel = (a: any) => { setSelectedAppt(null); setCancelTarget(a); };
  const openReschedule = (a: any) => { setSelectedAppt(null); setRescheduleTarget(a); };

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  // List view: single day
  const { data: dayData, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['appointments', dateStr, statusFilter, search],
    queryFn: () => appointmentsApi.list({
      date: dateStr,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: search || undefined,
      limit: 50,
    }),
    enabled: view === 'list',
  });

  // Week view: full week range
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const { data: weekData } = useQuery({
    queryKey: ['appointments-week', format(weekStart, 'yyyy-MM-dd')],
    queryFn: () => appointmentsApi.list({
      dateFrom: format(weekStart, 'yyyy-MM-dd'),
      dateTo: format(weekEnd, 'yyyy-MM-dd'),
      limit: 200,
    }),
    enabled: view === 'week',
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      appointmentsApi.updateStatus(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['appointments-week'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setSelectedAppt(null);
      toast.success('Status updated');
    },
    onError: (e) => toast.error(describeApiError(e, 'Failed to update status')),
  });

  const isToday = format(selectedDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

  return (
    <div className="relative">
      <Header
        title="Appointments"
        subtitle="Manage your clinic schedule"
        actions={
          <>
            {slotManager && (
              <Button size="sm" variant="outline" onClick={() => setShowSlots(true)}>
                <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                Manage slots
              </Button>
            )}
            <Button size="sm" onClick={() => setShowBook(true)} aria-label="New appointment">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              New Appointment
            </Button>
          </>
        }
      />

      <div className="page-content">
        {/* ── Toolbar ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* View toggle */}
          <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'week')}>
            <TabsList className="h-9">
              <TabsTrigger value="list" className="gap-1.5 text-xs px-3">
                <LayoutList className="w-3.5 h-3.5" /> List
              </TabsTrigger>
              <TabsTrigger value="week" className="gap-1.5 text-xs px-3">
                <LayoutGrid className="w-3.5 h-3.5" /> Week
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {view === 'list' && (
            <>
              {/* Date navigator */}
              <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 h-9">
                <button
                  onClick={() => setSelectedDate((d) => subDays(d, 1))}
                  className="p-1 hover:bg-slate-100 rounded transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
                </button>
                <div className="flex items-center gap-1.5 px-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-sm font-medium text-slate-700 min-w-[140px] text-center">
                    {format(selectedDate, 'EEE, d MMM yyyy')}
                  </span>
                  {isToday && (
                    <Badge variant="default" className="text-[10px] py-0 px-1.5 h-4">Today</Badge>
                  )}
                </div>
                <button
                  onClick={() => setSelectedDate((d) => addDays(d, 1))}
                  className="p-1 hover:bg-slate-100 rounded transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>

              {!isToday && (
                <Button variant="outline" size="sm"
                  onClick={() => setSelectedDate(new Date())}>
                  Today
                </Button>
              )}

              {/* Search */}
              <div className="flex-1 min-w-[180px] max-w-xs">
                <Input
                  placeholder="Search patient…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<Search className="w-3.5 h-3.5" />}
                  className="h-9 text-sm"
                />
              </div>

              {/* Status filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-36 text-sm">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          {view === 'week' && (
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 h-9">
              <button
                onClick={() => setWeekStart((w) => subWeeks(w, 1))}
                className="p-1 hover:bg-slate-100 rounded transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <span className="text-sm font-medium text-slate-700 px-2">
                {format(weekStart, 'd MMM')} – {format(weekEnd, 'd MMM yyyy')}
              </span>
              <button
                onClick={() => setWeekStart((w) => addWeeks(w, 1))}
                className="p-1 hover:bg-slate-100 rounded transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              </button>
              <Button variant="outline" size="sm" className="ml-1 h-7 text-xs"
                onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
                This Week
              </Button>
            </div>
          )}
        </div>

        {/* ── List view ─────────────────────────────────────────────────── */}
        {view === 'list' && (
          <Card className="overflow-hidden">
            {/* Mobile agenda: stacked cards instead of a wide table */}
            <div className="md:hidden" aria-label="Appointment agenda">
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2 border-b border-border p-4"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-2/3" /></div>
              ))}
              {isError && <div className="p-4"><ErrorState title="Could not load appointments" error={error} onRetry={() => refetch()} retrying={isFetching} compact /></div>}
              {!isLoading && !isError && (dayData?.items?.length ?? 0) === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-muted-foreground">
                  <Calendar className="h-10 w-10" aria-hidden="true" />
                  <p className="text-sm font-medium">No appointments{search ? ' matching your search' : ' for this day'}</p>
                  <Button size="sm" variant="outline" onClick={() => setShowBook(true)} className="mt-1"><Plus className="w-3.5 h-3.5" /> Book one</Button>
                </div>
              )}
              <ol className="divide-y divide-border">
                {dayData?.items?.map((a: any) => (
                  <li key={a.id} className="flex gap-3 p-4">
                    <div className="w-14 shrink-0 text-right" data-numeric>
                      <p className="text-sm font-semibold text-foreground">{a.startTime?.slice(0, 5)}</p>
                      <p className="text-xs text-muted-foreground">{a.endTime?.slice(0, 5)}</p>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5 border-l-2 border-primary/40 pl-3">
                      <p className="truncate text-sm font-medium text-foreground">{a.patient?.fullName}</p>
                      <p className="truncate text-xs capitalize text-muted-foreground">{a.type?.replace(/_/g, ' ')}{a.dentist?.fullName ? ` · ${formatDentist(a.dentist.fullName)}` : ''}</p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <StatusBadge status={a.status} />
                        <ApptActions appt={a} onStatus={(id, status) => updateStatus.mutate({ id, status })} onCancel={openCancel} onReschedule={openReschedule} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Time</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Dentist</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}

                {isError && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <ErrorState title="Could not load appointments" error={error} onRetry={() => refetch()} retrying={isFetching} compact />
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading && !isError && (dayData?.items?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Calendar className="w-10 h-10 text-slate-200" />
                        <p className="text-sm font-medium">No appointments{search ? ' matching your search' : ' for this day'}</p>
                        <Button size="sm" variant="outline" onClick={() => setShowBook(true)} className="mt-1">
                          <Plus className="w-3.5 h-3.5" /> Book one
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {dayData?.items?.map((a: any) => (
                  <TableRow key={a.id} className="group">
                    <TableCell>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{a.startTime?.slice(0, 5)}</p>
                        <p className="text-[11px] text-slate-400">{a.endTime?.slice(0, 5)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium text-slate-900">{a.patient?.fullName}</p>
                      <p className="text-[11px] text-slate-400">{a.patient?.phone}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-slate-600 capitalize">
                      {a.type?.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-slate-600">
                      {formatDentist(a.dentist?.fullName)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>
                      <ApptActions appt={a} onStatus={(id, status) => updateStatus.mutate({ id, status })} onCancel={openCancel} onReschedule={openReschedule} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            {(dayData?.total ?? 0) > 0 && (
              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
                <p className="text-xs text-slate-400">
                  {dayData?.total} appointment{dayData?.total !== 1 ? 's' : ''} on {format(selectedDate, 'd MMM yyyy')}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* ── Week view ─────────────────────────────────────────────────── */}
        {view === 'week' && (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <WeekCalendar
                appointments={weekData?.items ?? []}
                weekStart={weekStart}
                onSelectAppt={setSelectedAppt}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Appointment detail panel (week view) */}
      {selectedAppt && (
        <ApptDetailPanel
          appt={selectedAppt}
          onClose={() => setSelectedAppt(null)}
          onStatusChange={(id, status) => updateStatus.mutate({ id, status })}
          onCancel={openCancel}
          onReschedule={openReschedule}
        />
      )}

      {cancelTarget && <CancelAppointmentDialog appt={cancelTarget} onClose={() => setCancelTarget(null)} />}
      {rescheduleTarget && <RescheduleAppointmentDialog appt={rescheduleTarget} onClose={() => setRescheduleTarget(null)} />}
      {showSlots && <SlotManagerDialog onClose={() => setShowSlots(false)} initialDate={dateStr} />}

      {showBook && (
        <BookAppointmentModal
          onClose={() => {
            setShowBook(false);
            qc.invalidateQueries({ queryKey: ['appointments'] });
          }}
          defaultDate={dateStr}
        />
      )}
    </div>
  );
}
