'use client';
import { Toaster } from 'sonner';
import { isDarkTheme } from '@/lib/theme';
import { useTheme } from '@/lib/use-theme';

/** Sonner follows the active app theme (not just the OS preference). */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-right" richColors closeButton theme={isDarkTheme(theme) ? 'dark' : 'light'} />;
}
