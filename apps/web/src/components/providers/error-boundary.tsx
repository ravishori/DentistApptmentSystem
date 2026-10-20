'use client';

import React from 'react';
import { reportClientError } from '@/lib/error-reporter';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
  eventId:  string | null;
}

/**
 * ErrorBoundary — catches React render errors, reports them to the API,
 * and shows a user-friendly fallback instead of a blank white screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, eventId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportClientError({
      message:    error.message,
      stack:      error.stack,
      componentStack: info.componentStack ?? undefined,
      level:      'fatal',
      context:    'ErrorBoundary',
    }).then((id) => this.setState({ eventId: id ?? null })).catch(() => {});
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, eventId: null });
  };

  override render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.062 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">Something went wrong</h2>
        <p className="text-slate-500 text-sm mb-1 max-w-md">
          An unexpected error occurred. Our team has been notified automatically.
        </p>
        {this.state.eventId && (
          <p className="text-slate-400 text-xs mb-4">Reference: {this.state.eventId}</p>
        )}
        <div className="flex gap-3 mt-2">
          <Button variant="outline" onClick={this.handleReset}>Try again</Button>
          <Button onClick={() => window.location.href = '/'}>Go to dashboard</Button>
        </div>
        {process.env.NODE_ENV === 'development' && this.state.error && (
          <pre className="mt-6 text-left text-xs bg-red-50 text-red-700 p-4 rounded-lg max-w-2xl overflow-auto w-full">
            {this.state.error.stack}
          </pre>
        )}
      </div>
    );
  }
}
