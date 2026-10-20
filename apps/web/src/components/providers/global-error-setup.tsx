'use client';

import { useEffect } from 'react';
import { installGlobalErrorHandlers } from '@/lib/error-reporter';

/**
 * GlobalErrorSetup — tiny client component that installs
 * window.onerror and window.onunhandledrejection handlers once on mount.
 * Renders nothing visible.
 */
export function GlobalErrorSetup() {
  useEffect(() => {
    installGlobalErrorHandlers();
  }, []);

  return null;
}
