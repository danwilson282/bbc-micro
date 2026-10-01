// Small DOM helpers shared by the workbench panels.

/** A plain (non-submit) button with visible text and an accessible name. */
export function button(text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  return b;
}
