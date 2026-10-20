'use client';

import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/error-reporter';

/** Route-segment error boundary: a render error in any page shows a safe message + reference instead of a blank screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [eventId, setEventId] = useState<string | undefined>(error.digest);

  useEffect(() => {
    // The message/stack go to the API (sanitised there); they are never rendered to the user.
    reportClientError({ message: error.message, stack: error.stack, level: 'fatal', context: 'app/error.tsx' })
      .then((id) => { if (id) setEventId(id); })
      .catch(() => undefined);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16">
      <ErrorState
        title="Something went wrong"
        message="An unexpected error occurred while showing this page. The team has been notified."
        reference={eventId}
        onRetry={reset}
      />
    </div>
  );
}
