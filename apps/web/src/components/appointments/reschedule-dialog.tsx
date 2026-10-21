'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { describeApiError } from '@/lib/api-error';
import {
  buildReschedulePayload, hasErrors, toHHMM, todayString, validateReschedule, REASON_MAX,
} from '@/lib/appointment-rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { ErrorState } from '@/components/ui/error-state';
import { DialogShell, ApptSummary } from './dialog-shell';

/**
 * Moves an appointment to another free slot of the SAME dentist (the API keeps the dentist). Only slots the API reports as
 * free are offered; the API re-checks availability atomically, so a slot taken meanwhile comes back as a conflict.
 */
export function RescheduleAppointmentDialog({ appt, onClose }: { appt: any; onClose: () => void }) {
  const qc = useQueryClient();
  const currentDate = String(appt.appointmentDate ?? '').slice(0, 10);
  const [date, setDate] = useState(currentDate >= todayString() ? currentDate : todayString());
  const [startTime, setStartTime] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inFlight = useRef(false); // set synchronously: state-based guards miss clicks that land in the same tick

  const errors = validateReschedule({ date, startTime, reason, currentDate, currentStartTime: appt.startTime });
  const dateValid = !errors.date;

  const slotsQ = useQuery({
    queryKey: ['slots', appt.dentistId, date],
    queryFn: () => appointmentsApi.slots(appt.dentistId, date),
    enabled: !!appt.dentistId && dateValid,
  });
  const slots: any[] = Array.isArray(slotsQ.data) ? slotsQ.data : [];

  const move = useMutation({
    mutationFn: () => appointmentsApi.reschedule(appt.id, buildReschedulePayload({ date, startTime, reason })),
    onSuccess: () => {
      for (const key of ['appointments', 'appointments-week', 'dashboard-stats', 'slots']) qc.invalidateQueries({ queryKey: [key] });
      toast.success('Appointment rescheduled');
      onClose();
    },
    onError: (e) => {
      // 400 "not available" / 409 "no longer available": the list is stale, so reload it and make the user pick again
      setServerError(describeApiError(e, 'Could not reschedule the appointment'));
      setStartTime('');
      setSubmitted(false); // the server message is the feedback; do not also flag the cleared selection
      void slotsQ.refetch();
    },
    onSettled: () => { inFlight.current = false; },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return; // double-submit protection
    setSubmitted(true);
    setServerError(null);
    if (hasErrors(errors)) return;
    inFlight.current = true;
    move.mutate();
  };

  return (
    <DialogShell title="Reschedule appointment" description="Choose a new date and an available time with the same dentist." onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ApptSummary appt={appt} />

        <div className="max-w-xs">
          <label htmlFor="resched-date" className="label">New date *</label>
          <Input
            id="resched-date"
            type="date"
            value={date}
            min={todayString()}
            onChange={(e) => { setDate(e.target.value); setStartTime(''); setServerError(null); }}
            error={!!errors.date}
            aria-describedby={errors.date ? 'resched-date-error' : undefined}
          />
          {errors.date && <p id="resched-date-error" role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.date}</p>}
        </div>

        <div>
          <p className="label" id="resched-slot-label">Available times *</p>
          {!dateValid ? null : slotsQ.isLoading ? (
            <div className="grid grid-cols-3 gap-2" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
          ) : slotsQ.isError && slotsQ.data === undefined ? (
            <ErrorState compact title="Could not load available times" error={slotsQ.error} onRetry={() => { void slotsQ.refetch(); }} retrying={slotsQ.isFetching} />
          ) : slots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="no-slots">
              No free times on this date. Try another date.
            </p>
          ) : (
            <ChoiceGroup
              name="resched-slot"
              label="Available times"
              value={startTime || null}
              onChange={setStartTime}
              options={slots.map((s) => ({ id: toHHMM(s.startTime), label: `${toHHMM(s.startTime)} – ${toHHMM(s.endTime)}` }))}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            />
          )}
          {(submitted || errors.startTime?.startsWith('That')) && errors.startTime && (
            <p role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.startTime}</p>
          )}
        </div>

        <div>
          <label htmlFor="resched-reason" className="label">Reason (optional)</label>
          <Textarea id="resched-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={2} placeholder="e.g. Patient asked for an evening slot" />
        </div>

        {serverError && <Alert variant="destructive" title="Not rescheduled">{serverError}</Alert>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={move.isPending}>Close</Button>
          <Button type="submit" loading={move.isPending}>Confirm new time</Button>
        </div>
      </form>
    </DialogShell>
  );
}
