'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { appointmentsApi } from '@/lib/api';
import { describeApiError } from '@/lib/api-error';
import { validateCancelReason, hasErrors, REASON_MAX } from '@/lib/appointment-rules';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { DialogShell, ApptSummary } from './dialog-shell';

/**
 * Destructive action: cancelling releases the slot and cannot be undone from here, so it needs an explicit confirmation
 * and a reason (stored on the appointment and in the audit trail by the API).
 */
export function CancelAppointmentDialog({ appt, onClose }: { appt: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inFlight = useRef(false); // set synchronously: state-based guards miss clicks that land in the same tick
  const errors = validateCancelReason(reason);

  const cancel = useMutation({
    mutationFn: () => appointmentsApi.updateStatus(appt.id, { status: 'cancelled', reason: reason.trim() }),
    onSuccess: () => {
      for (const key of ['appointments', 'appointments-week', 'dashboard-stats', 'slots']) qc.invalidateQueries({ queryKey: [key] });
      toast.success('Appointment cancelled');
      onClose();
    },
    onError: (e) => setServerError(describeApiError(e, 'Could not cancel the appointment')),
    onSettled: () => { inFlight.current = false; },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return; // double-submit protection
    setSubmitted(true);
    setServerError(null);
    if (hasErrors(errors)) return;
    inFlight.current = true;
    cancel.mutate();
  };

  return (
    <DialogShell title="Cancel this appointment?" description="The time slot is released and can be booked again." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <ApptSummary appt={appt} />
        <div>
          <label htmlFor="cancel-reason" className="label">Reason for cancelling *</label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX}
            rows={3}
            placeholder="e.g. Patient called to cancel"
            error={submitted && !!errors.reason}
            aria-describedby={submitted && errors.reason ? 'cancel-reason-error' : undefined}
          />
          {submitted && errors.reason && <p id="cancel-reason-error" role="alert" className="mt-1 text-xs font-medium text-destructive">{errors.reason}</p>}
        </div>
        {serverError && <Alert variant="destructive" title="Not cancelled">{serverError}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={cancel.isPending}>Keep appointment</Button>
          <Button type="submit" variant="destructive" loading={cancel.isPending}>Cancel appointment</Button>
        </div>
      </form>
    </DialogShell>
  );
}
