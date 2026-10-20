'use client';
import { useEffect } from 'react';

const CONTROLS = 'input:not([type="hidden"]), select, textarea, [role="combobox"], [role="switch"]';
let counter = 0;

/** Give a form control an id (if missing) and point the label at it. */
function associate(label: HTMLLabelElement) {
  if (label.htmlFor || label.querySelector(CONTROLS)) return;

  // The control is the label's next sibling, or the first control inside it; failing that,
  // the first control that follows the label within the same parent.
  let control: HTMLElement | null = null;
  const next = label.nextElementSibling as HTMLElement | null;
  if (next) control = next.matches(CONTROLS) ? next : next.querySelector<HTMLElement>(CONTROLS);
  // Climb a few levels (e.g. label sits in a flex row beside a "Forgot password?" link)
  for (let scope = label.parentElement, depth = 0; !control && scope && depth < 3; scope = scope.parentElement, depth++) {
    const all = Array.from(scope.querySelectorAll<HTMLElement>(CONTROLS));
    control = all.find((el) => label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null;
    // Never reach past another label: that control belongs to it
    if (control) {
      const c = control;
      const between = Array.from(scope.querySelectorAll('label')).some(
        (other) => other !== label
          && label.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING
          && other.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      if (between) control = null;
    }
  }
  if (!control) return;

  if (!control.id) control.id = `field-${++counter}`;
  label.htmlFor = control.id;
}

/** Icon-only buttons that only carry a `title` get it as their accessible name. */
function nameFromTitle(button: HTMLElement) {
  if (button.hasAttribute('aria-label') || button.hasAttribute('aria-labelledby')) return;
  const title = button.getAttribute('title');
  if (title && !button.textContent?.trim()) button.setAttribute('aria-label', title);
}

function enhance(root: ParentNode) {
  root.querySelectorAll<HTMLLabelElement>('label').forEach(associate);
  root.querySelectorAll<HTMLElement>('button[title], a[title]').forEach(nameFromTitle);
}

/**
 * Progressive accessibility fix-up for markup that predates the design system: associates
 * <label>s with their controls (so clicking a label focuses the field and screen readers announce it)
 * and names title-only icon buttons. New code should use <FormField> instead; this never overrides
 * explicit htmlFor / aria-label values.
 */
export function A11yEnhancer() {
  useEffect(() => {
    enhance(document);
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => enhance(document));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
