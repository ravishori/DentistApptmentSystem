'use client';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Lock, LockOpen } from 'lucide-react';
import { appointmentsApi, usersApi } from '@/lib/api';
import { describeApiError } from '@/lib/api-error';
import { BLOCK_REASON_MAX, slotState, todayString, toHHMM, validateBlockReason, type SlotRow } from '@/lib/appointment-rules';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { DialogShell } from './dialog-shell';

type Pending = { slot: SlotRow; action: 'block' | 'unblock' } | null;

/**
 * Block and unblock a dentist's slots for a day (leave, maintenance, training). Both actions ask for confirmation; blocking
 * needs a reason. A booked slot cannot be blocked: the API refuses it, and the UI does not offer it.
 */
export function SlotManagerDialog({
  onClose, initialDentistId = '', initialDate,
}: { onClose: () => void; initialDentistId?: string; initialDate?: string }) {
  const qc = useQueryClient();
  const [dentistId, setDentistId] = useState(initialDentistId);
  const [date, setDate] = useState(initialDate ?? todayString());
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inFlight = useRef(false); // set synchronously: state-based guards miss clicks that land in the same tick

  const dentistsQ = useQuery({ queryKey: ['dentists'], queryFn: usersApi.dentists });
  const dentists: any[] = Array.isArray(dentistsQ.data) ? dentistsQ.data : [];

  const slotsQ = useQuery({
    queryKey: ['all-slots', dentistId, date],
    queryFn: () => appointmentsApi.allSlots(dentistId, date),
    enabled: !!dentistId && /^\d{4}-\d{2}-\d{2}$/.test(date),
  });
  const slots: SlotRow[] = Array.isArray(slotsQ.data) ? slotsQ.data : [];

  const reasonErrors = validateBlockReason(reason);

  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['all-slots'] });
    qc.invalidateQueries({ queryKey: ['slots'] });
    toast.success(msg);
    setPending(null); setReason(''); setSubmitted(false); setServerError(null);
  };
  const fail = (e: unknown) => {
    setServerError(describeApiError(e, 'The slot could not be changed'));
    void slotsQ.refetch(); // the slot may have been booked or changed meanwhile
  };
  const block = useMutation({ mutationFn: (v: { id: string; reason: string }) => appointmentsApi.blockSlot(v.id, v.reason), onSuccess: () => done('Slot blocked'), onError: fail, onSettled: () => { inFlight.current = false; } });
  const unblock = useMutation({ mutationFn: (id: string) => appointmentsApi.unblockSlot(id), onSuccess: () => done('Slot unblocked'), onError: fail, onSettled: () => { inFlight.current = false; } });
  const busy = block.isPending || unblock.isPending;

  const confirm = () => {
    if (!pending || inFlight.current) return;
    setServerError(null);
    if (pending.action === 'unblock') { inFlight.current = true; unblock.mutate(pending.slot.id); return; }
    setSubmitted(true);
    if (Object.keys(reasonErrors).length) return;
    inFlight.current = true;
    block.mutate({ id: pending.slot.id, reason: reason.trim() });
  };

  const start = (slot: SlotRow, action: 'block' | 'unblock') => { setPending({ slot, action }); setReason(''); setSubmitted(false); setServerError(null); };

  return (
    <DialogShell title="Manage slots" description="Block times when a dentist is unavailable, or release a blocked time." onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="slots-dentist" className="label">Dentist</label>
            <select
              id="slots-dentist"
              className="input-base"
              value={dentistId}
              onChange={(e) => { setDentistId(e.target.value); setPending(null); }}
            >
              <option value="">Select a dentist…</option>
              {dentists.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </select>
            {dentistsQ.isError && <p role="alert" className="mt-1 text-xs font-medium text-destructive">Could not load dentists. {describeApiError(dentistsQ.error, '')}</p>}
          </div>
          <div>
            <label htmlFor="slots-date" className="label">Date</label>
            <Input id="slots-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPending(null); }} />
          </div>
        </div>

        {!dentistId ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Choose a dentist and a date to see their slots.</p>
        ) : slotsQ.isLoading ? (
          <div className="space-y-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : slotsQ.isError && slotsQ.data === undefined ? (
          <ErrorState compact title="Could not load slots" error={slotsQ.error} onRetry={() => { void slotsQ.refetch(); }} retrying={slotsQ.isFetching} />
        ) : slots.length === 0 ? (
          <EmptyState title="No slots for this date" description="Slots are generated from the dentist's availability. Nothing to block or unblock here." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Slots">
            {slots.map((s) => {
              const state = slotState(s);
              const isPending = pending?.slot.id === s.id;
              return (
                <li key={s.id} className="space-y-2 p-3" data-slot-state={state}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground tabular-nums">{toHHMM(s.startTime)} – {toHHMM(s.endTime)}</p>
                      {state === 'blocked' && s.blockReason && <p className="text-xs text-muted-foreground">Reason: {s.blockReason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {state === 'available' && <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Available</span>}
                      {state === 'booked' && <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> Booked</span>}
                      {state === 'blocked' && <span className="inline-flex items-center gap-1 text-xs font-medium text-warning"><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Blocked</span>}
                      {state === 'available' && <Button size="sm" variant="outline" onClick={() => start(s, 'block')} disabled={busy}><Ban className="h-3.5 w-3.5" aria-hidden="true" /> Block</Button>}
                      {state === 'blocked' && <Button size="sm" variant="outline" onClick={() => start(s, 'unblock')} disabled={busy}><LockOpen className="h-3.5 w-3.5" aria-hidden="true" /> Unblock</Button>}
                    </div>
                  </div>

                  {isPending && (
                    <div className="space-y-2 rounded-lg border border-border bg-muted p-3" role="group" aria-label={pending!.action === 'block' ? 'Confirm block' : 'Confirm unblock'}>
                      {pending!.action === 'block' ? (
                        <>
                          <p className="text-sm text-foreground">Block {toHHMM(s.startTime)}? Nobody will be able to book it.</p>
                          <label htmlFor={`block-reason-${s.id}`} className="label">Reason *</label>
                          <Input
                            id={`block-reason-${s.id}`}
                            value={reason}
                            maxLength={BLOCK_REASON_MAX}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="e.g. Dentist on leave"
                            error={submitted && !!reasonErrors.reason}
                          />
                          {submitted && reasonErrors.reason && <p role="alert" className="text-xs font-medium text-destructive">{reasonErrors.reason}</p>}
                        </>
                      ) : (
                        <p className="text-sm text-foreground">Unblock {toHHMM(s.startTime)}? It becomes available for booking again.</p>
                      )}
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
                        <Button size="sm" variant={pending!.action === 'block' ? 'destructive' : 'default'} onClick={confirm} loading={busy}>
                          {pending!.action === 'block' ? 'Block slot' : 'Unblock slot'}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {serverError && <Alert variant="destructive" title="Not changed">{serverError}</Alert>}
        {slotsQ.isError && slotsQ.data !== undefined && <Alert variant="warning" title="Could not refresh">Showing the last loaded slots, which may be out of date.</Alert>}
      </div>
    </DialogShell>
  );
}
