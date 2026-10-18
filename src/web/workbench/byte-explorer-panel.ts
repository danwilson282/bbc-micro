// The Byte explorer (Stage 41): type a screen byte, or flip its bits, and see
// the pixels MODE 0, 1 and 2 would draw from it. Each bit is tinted by the
// pixel that owns it, which shows the interleave. Clicking a pixel moves it
// to its next logical colour and rewrites the byte. A last row decodes the
// byte with the machine's ULA as it is now.
//
// All decisions come from byte-explorer-view-model.ts; this file only builds
// elements. They're built once and only text, colours and classes change on
// refresh, except the live row, whose pixel count follows the ULA.

import type { VideoUla } from '../../devices/video-ula';
import { hex8 } from '../../util/bits';
import { EXPLORER_MODES, buildByteExplorerView, cyclePixel, parseByte, toggleBit, type ExplorerPixel } from './byte-explorer-view-model';
import type { Panel } from './panel';

const START_BYTE = 0xa5;

/** Physical colours dark enough to want white text: black, red, blue, magenta. */
const DARK_COLOURS: ReadonlySet<number> = new Set([0, 1, 4, 5]);

function paintPixel(el: HTMLElement, p: ExplorerPixel): void {
  el.textContent = p.label;
  el.title = p.title;
  el.style.background = p.css;
  el.style.color = DARK_COLOURS.has(p.colour) ? '#fff' : '#000';
  el.style.flexGrow = String(p.width);
  el.classList.toggle('flashing', p.flashing);
  el.dataset.colour = String(p.colour);
}

export function createByteExplorerPanel(ula: VideoUla): Panel {
  let byte = START_BYTE;

  const element = document.createElement('div');
  element.className = 'explorer-panel';

  const form = document.createElement('form');
  form.className = 'explorer-form';
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.name = 'byte';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.size = 10;
  label.append('Byte ', input);
  const summary = document.createElement('span');
  summary.className = 'explorer-summary';
  summary.dataset.field = 'summary';
  form.append(label, summary);

  const bitRow = document.createElement('div');
  bitRow.className = 'explorer-bits';
  bitRow.setAttribute('aria-label', 'Bits 7 to 0: click to flip');
  const bitButtons: HTMLButtonElement[] = [];
  for (let i = 0; i < 8; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.bit = String(7 - i);
    b.addEventListener('click', () => {
      setByte(toggleBit(byte, 7 - i));
    });
    bitButtons.push(b);
    bitRow.append(b);
  }

  interface ModeCells {
    readonly heading: HTMLParagraphElement;
    readonly owners: HTMLSpanElement[];
    readonly pixels: HTMLButtonElement[];
  }
  const initial = buildByteExplorerView({ byte });
  const modeCells: ModeCells[] = [];
  const rows: HTMLElement[] = [];
  for (const r of initial.modes) {
    const section = document.createElement('div');
    section.className = 'explorer-mode';
    section.dataset.mode = String(r.mode);
    const heading = document.createElement('p');
    heading.className = 'explorer-heading';
    const ownerStrip = document.createElement('div');
    ownerStrip.className = 'explorer-owners';
    ownerStrip.setAttribute('aria-label', `MODE ${String(r.mode)}: the pixel each bit belongs to`);
    const owners = Array.from({ length: 8 }, () => {
      const s = document.createElement('span');
      ownerStrip.append(s);
      return s;
    });
    const strip = document.createElement('div');
    strip.className = 'explorer-pixels';
    const pixels = r.pixels.map((_, p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'explorer-pixel';
      b.dataset.pixel = String(p);
      b.addEventListener('click', () => {
        setByte(cyclePixel(byte, r.bitsPerPixel, p));
      });
      strip.append(b);
      return b;
    });
    section.append(heading, ownerStrip, strip);
    rows.push(section);
    modeCells.push({ heading, owners, pixels });
  }

  const live = document.createElement('div');
  live.className = 'explorer-mode explorer-live';
  const liveHeading = document.createElement('p');
  liveHeading.className = 'explorer-heading';
  const liveStrip = document.createElement('div');
  liveStrip.className = 'explorer-pixels';
  live.append(liveHeading, liveStrip);

  element.append(form, bitRow, ...rows, live);

  function setByte(value: number): void {
    byte = value & 0xff;
    input.value = `&${hex8(byte)}`;
    refresh();
  }

  input.addEventListener('input', () => {
    const parsed = parseByte(input.value);
    input.classList.toggle('invalid', parsed === undefined);
    if (parsed === undefined) return;
    byte = parsed;
    refresh();
  });
  input.addEventListener('change', () => {
    input.classList.remove('invalid');
    input.value = `&${hex8(byte)}`;
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.value = `&${hex8(byte)}`;
  });
  input.value = `&${hex8(byte)}`;

  function refresh(): void {
    const view = buildByteExplorerView({
      byte,
      ula: { control: ula.control, entries: Array.from({ length: 16 }, (_, i) => ula.paletteEntry(i)) },
    });
    summary.textContent = view.summary;
    bitButtons.forEach((b, i) => {
      const v = view.bits[i] ?? 0;
      b.textContent = `b${String(7 - i)} ${String(v)}`;
      b.setAttribute('aria-pressed', String(v === 1));
    });
    EXPLORER_MODES.forEach((_, m) => {
      const r = view.modes.at(m);
      const cells = modeCells.at(m);
      if (r === undefined || cells === undefined) return;
      cells.heading.textContent = r.heading;
      cells.owners.forEach((s, i) => {
        const owner = String(r.bitOwners[i] ?? 0);
        s.className = `owner-${owner}`;
        s.textContent = `p${owner}`;
        s.title = `Bit ${String(7 - i)} belongs to pixel ${owner}`;
      });
      cells.pixels.forEach((el, p) => {
        const px = r.pixels.at(p);
        if (px !== undefined) paintPixel(el, px);
      });
    });
    live.hidden = view.live === undefined;
    if (view.live !== undefined) {
      liveHeading.textContent = view.live.heading;
      while (liveStrip.children.length < view.live.pixels.length) {
        const s = document.createElement('span');
        s.className = 'explorer-pixel';
        liveStrip.append(s);
      }
      while (liveStrip.children.length > view.live.pixels.length) liveStrip.lastElementChild?.remove();
      view.live.pixels.forEach((px, p) => {
        const el = liveStrip.children[p];
        if (el instanceof HTMLElement) paintPixel(el, px);
      });
    }
  }

  return { title: 'Byte explorer', element, refresh };
}
