'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown by the root layout itself. It replaces the whole document, so it cannot rely
 * on the app's providers or stylesheet: plain markup and inline styles only.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Best effort, never throws; the message is sanitised server-side.
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
    fetch(`${base}/errors/client`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(error.message).slice(0, 500), level: 'fatal', context: 'global-error.tsx' }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div role="alert" style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#555', marginBottom: 12 }}>The application hit an unexpected error. Your data is safe.</p>
          {error.digest && <p style={{ color: '#777', fontSize: 12 }}>Reference for support: {error.digest}</p>}
          <button type="button" onClick={reset} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
