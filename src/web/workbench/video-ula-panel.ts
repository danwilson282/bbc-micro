// The Video ULA panel (Stage 40): the control byte decoded bit by bit and
// the 16 palette entries as swatches, each the colour it gives now.
//
// All decisions come from video-ula-view-model.ts; this file only builds
// elements. They're built once and only their text, colours and classes
// change on refresh (the Stage 24/26 lesson), so flashing entries change
// colour in place as the MOS flips the flash bit.

import type { VideoUla } from '../../devices/video-ula';
import type { Panel } from './panel';
import { buildVideoUlaView } from './video-ula-view-model';

const FIELD_COUNT = 5;
const ENTRY_COUNT = 16;

export function createVideoUlaPanel(ula: VideoUla): Panel {
  const element = document.createElement('div');
  element.className = 'ula-panel';

  const summary = document.createElement('p');
  summary.className = 'ula-summary';
  summary.dataset.field = 'summary';

  const table = document.createElement('table');
  table.className = 'crtc-table ula-fields';
  table.setAttribute('aria-label', 'Control register &FE20');
  const head = table.createTHead().insertRow();
  for (const text of ['Bits', 'Field', 'Value', 'Means']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  interface FieldCells {
    readonly bits: HTMLTableCellElement;
    readonly name: HTMLTableCellElement;
    readonly value: HTMLTableCellElement;
    readonly meaning: HTMLTableCellElement;
  }
  const fieldCells: FieldCells[] = [];
  for (let i = 0; i < FIELD_COUNT; i++) {
    const row = body.insertRow();
    const bits = document.createElement('th');
    bits.scope = 'row';
    row.append(bits);
    const name = row.insertCell();
    const value = row.insertCell();
    value.className = 'value';
    const meaning = row.insertCell();
    meaning.className = 'meaning';
    fieldCells.push({ bits, name, value, meaning });
  }

  const swatchList = document.createElement('ol');
  swatchList.className = 'ula-swatches';
  swatchList.setAttribute('aria-label', 'Palette &FE21: entries 0-F');
  interface SwatchCells {
    readonly item: HTMLLIElement;
    readonly chip: HTMLDivElement;
    readonly label: HTMLDivElement;
    readonly name: HTMLDivElement;
  }
  const swatchCells: SwatchCells[] = [];
  for (let i = 0; i < ENTRY_COUNT; i++) {
    const item = document.createElement('li');
    item.className = 'ula-swatch';
    item.dataset.entry = String(i);
    const chip = document.createElement('div');
    chip.className = 'ula-chip';
    const label = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'ula-name';
    item.append(chip, label, name);
    swatchList.append(item);
    swatchCells.push({ item, chip, label, name });
  }

  const note = document.createElement('p');
  note.className = 'ula-note';

  element.append(summary, table, swatchList, note);

  function refresh(): void {
    const view = buildVideoUlaView({ control: ula.control, entries: Array.from({ length: ENTRY_COUNT }, (_, i) => ula.paletteEntry(i)) });
    summary.textContent = view.summary;
    fieldCells.forEach((c, i) => {
      const f = view.fields.at(i);
      if (f === undefined) return;
      c.bits.textContent = f.bits;
      c.name.textContent = f.name;
      c.value.textContent = f.value;
      c.meaning.textContent = f.meaning;
    });
    swatchCells.forEach((c, i) => {
      const s = view.swatches.at(i);
      if (s === undefined) return;
      c.chip.style.background = s.css;
      c.label.textContent = `${s.entry} ${s.binary} ${s.stored}`;
      // A zero-width space after the slash: "black/white" wraps there, not mid-word.
      c.name.textContent = s.name.replace('/', '/\u200b');
      c.item.title = s.title;
      c.item.dataset.colour = String(s.colour);
      c.item.classList.toggle('flashing', s.flashing);
    });
    note.textContent = view.note;
  }

  return { title: 'Video ULA', element, refresh };
}
