'use client';
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Drop-in behaviour for hand-rolled modal/drawer overlays that already render
 * `role="dialog" aria-modal="true"` on their wrapper. Provides what Radix Dialog gives for free:
 *   – Escape closes
 *   – focus moves into the dialog on open, is trapped on Tab, and returns to the trigger on close
 *   – background scroll is locked while open
 * Render it as the first child of the dialog wrapper.
 */
export function ModalBehavior({ onClose }: { onClose: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = marker.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    // Prefer the first form field; fall back to the first focusable element
    (dialog.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea') ?? focusables()[0])?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  return <span ref={marker} hidden />;
}
