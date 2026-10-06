// The number converter: four linked fields (hex, decimal, binary, ASCII).
//
// All the reasoning is in converter-view-model.ts. Typing into a field
// rewrites the other three on every keystroke but leaves the one being typed
// in alone (so the cursor doesn't jump). When you leave the field it is
// tidied into the standard form, e.g. "41" becomes "&41". It doesn't read
// the emulator at all, so refresh() has nothing to do.

import { convertFrom, type Conversion, type NumberField } from './converter-view-model';
import type { Panel } from './panel';

const FIELDS: readonly (readonly [NumberField, string])[] = [
  ['hex', 'Hex'],
  ['decimal', 'Decimal'],
  ['binary', 'Binary'],
  ['ascii', 'ASCII'],
];

/** The text a field shows for a conversion. */
function textFor(field: NumberField, c: Conversion): string {
  return c[field];
}

export function createConverterPanel(): Panel {
  const element = document.createElement('div');
  element.className = 'converter-panel';

  const form = document.createElement('form');
  form.className = 'converter-form';
  const inputs = new Map<NumberField, HTMLInputElement>();
  for (const [field, label] of FIELDS) {
    const wrap = document.createElement('label');
    wrap.className = 'converter-field';
    const input = document.createElement('input');
    input.name = field;
    input.spellcheck = false;
    input.autocomplete = 'off';
    wrap.append(label, input);
    form.append(wrap);
    inputs.set(field, input);
  }

  const status = document.createElement('p');
  status.className = 'converter-status';
  status.setAttribute('role', 'status');
  const notes = document.createElement('ul');
  notes.className = 'converter-notes';
  element.append(form, status, notes);

  /** Fills every field except `except` from c, and lists its notes. */
  function show(c: Conversion, except?: NumberField): void {
    for (const [field, input] of inputs) {
      input.removeAttribute('aria-invalid');
      if (field === 'ascii') input.placeholder = c.asciiHint;
      if (field !== except) input.value = textFor(field, c);
    }
    status.textContent = `${c.hex} = ${c.decimal} (${String(c.width)}-bit)`;
    status.classList.remove('error');
    notes.replaceChildren(
      ...c.notes.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
  }

  /** Converts from the field that was typed in; returns the conversion if valid. */
  function update(field: NumberField, input: HTMLInputElement): Conversion | undefined {
    const result = convertFrom(field, input.value);
    if (!result.ok) {
      input.setAttribute('aria-invalid', 'true');
      status.textContent = result.error;
      status.classList.add('error');
      return undefined;
    }
    show(result.conversion, field);
    return result.conversion;
  }

  for (const [field, input] of inputs) {
    input.addEventListener('input', () => {
      update(field, input);
    });
    // On leaving the field (or pressing Enter), tidy it into the standard form.
    input.addEventListener('change', () => {
      const c = update(field, input);
      if (c !== undefined) input.value = textFor(field, c);
    });
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
  });

  const initial = convertFrom('hex', '&41');
  if (initial.ok) show(initial.conversion);

  return {
    title: 'Number converter',
    element,
    refresh() {
      // Nothing to redraw: the converter doesn't depend on the emulator's state.
    },
  };
}
