'use client';
import * as React from 'react';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ModalBehavior } from '@/components/ui/modal-behavior';

/** Shared modal frame for the appointment dialogs (same look and behaviour as the booking modal: Esc, focus trap, scroll lock). */
export function DialogShell({
  title, description, onClose, children, wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const titleId = React.useId();
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <ModalBehavior onClose={onClose} />
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <Card className={`relative max-h-[90vh] w-full overflow-y-auto shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle id={titleId} className="text-base">{title}</CardTitle>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

/** "Wed 21 Oct, 10:00–10:30 · Riya Sharma": the line every dialog shows so staff confirm they picked the right appointment. */
export function ApptSummary({ appt }: { appt: any }) {
  const date = appt?.appointmentDate ? String(appt.appointmentDate).slice(0, 10) : '';
  return (
    <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground" data-testid="appt-summary">
      <span className="font-medium">{appt?.patient?.fullName ?? 'Patient'}</span>
      <span className="text-muted-foreground"> · {date} · {String(appt?.startTime ?? '').slice(0, 5)}–{String(appt?.endTime ?? '').slice(0, 5)}</span>
    </p>
  );
}
