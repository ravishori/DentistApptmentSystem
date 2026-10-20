'use client';

import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui/error-state';
import { reportClientError } from '@/lib/error-reporter';

/** Dashboard-section boundary: the sidebar/header stay usable while the failing page shows a recoverable error. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [eventId, setEventId] = useState<string | undefined>(error.digest);

  useEffect(() => {
    reportClientError({ message: error.message, stack: error.stack, level: 'fatal', context: '(dashboard)/error.tsx' })
      .then((id) => { if (id) setEventId(id); })
      .catch(() => undefined);
  }, [error]);

  return (
    <div className="page-content">
      <ErrorState
        title="This page hit a problem"
        message="An unexpected error occurred. Your data is safe. Try again, or open another section from the menu."
        reference={eventId}
        onRetry={reset}
      />
    </div>
  );
}
