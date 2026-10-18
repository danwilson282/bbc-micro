// The Sound panel (Stage 44): the SN76489's registers as four channel rows,
// the latched register, and the last bytes the chip took in, decoded.
//
// All decisions come from sound-view-model.ts; this file only builds
// elements. They're built once and only their text changes on refresh (the
// Stage 24/26 lesson), so the rows don't flicker while the machine runs.

import type { Sn76489 } from '../../devices/sn76489';
import type { HardwareLog } from '../../devices/hardware-log';
import type { Panel } from './panel';
import { SOUND_BYTES_SHOWN, buildSoundView } from './sound-view-model';

const CHANNELS = 4;
/** Enough of the hardware log to find the last few sound bytes among the CRTC and ULA writes. */
const LOG_LOOKBACK = 512;

export function createSoundPanel(sound: Sn76489, log: HardwareLog): Panel {
  const element = document.createElement('div');
  element.className = 'sound-panel';

  const summary = document.createElement('p');
  summary.className = 'sound-summary';

  const table = document.createElement('table');
  table.className = 'crtc-table sound-channels';
  table.setAttribute('aria-label', 'SN76489 channels');
  const head = table.createTHead().insertRow();
  for (const text of ['Chip', 'SOUND', 'Tone / noise', 'Pitch', 'Attenuation', 'Level']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = text;
    head.append(th);
  }
  const body = table.createTBody();
  interface ChannelCells {
    readonly row: HTMLTableRowElement;
    readonly chip: HTMLTableCellElement;
    readonly basic: HTMLTableCellElement;
    readonly tone: HTMLTableCellElement;
    readonly pitch: HTMLTableCellElement;
    readonly attenuation: HTMLTableCellElement;
    readonly bar: HTMLDivElement;
  }
  const channelCells: ChannelCells[] = [];
  for (let i = 0; i < CHANNELS; i++) {
    const row = body.insertRow();
    row.dataset.channel = String(i);
    const chip = document.createElement('th');
    chip.scope = 'row';
    row.append(chip);
    const basic = row.insertCell();
    const tone = row.insertCell();
    tone.className = 'hex';
    const pitch = row.insertCell();
    pitch.className = 'hex';
    const attenuation = row.insertCell();
    attenuation.className = 'hex';
    const levelCell = row.insertCell();
    const track = document.createElement('div');
    track.className = 'sound-level';
    const bar = document.createElement('div');
    bar.className = 'sound-level-bar';
    track.append(bar);
    levelCell.append(track);
    channelCells.push({ row, chip, basic, tone, pitch, attenuation, bar });
  }

  const latched = document.createElement('p');
  latched.className = 'sound-latched';

  const bytesHeading = document.createElement('p');
  bytesHeading.className = 'sound-bytes-heading';
  bytesHeading.textContent = `Latest bytes on the slow data bus (port A as IC32 bit 0 fell; up to ${String(SOUND_BYTES_SHOWN)}):`;
  const bytesList = document.createElement('ol');
  bytesList.className = 'sound-bytes';
  const byteItems: HTMLLIElement[] = [];
  for (let i = 0; i < SOUND_BYTES_SHOWN; i++) {
    const item = document.createElement('li');
    bytesList.append(item);
    byteItems.push(item);
  }

  element.append(summary, table, latched, bytesHeading, bytesList);

  function refresh(): void {
    const recent = log
      .recent(LOG_LOOKBACK)
      .filter((w) => w.device === 'sound')
      .map((w) => ({ register: w.register, value: w.value }));
    const view = buildSoundView({
      registers: Array.from({ length: 8 }, (_, r) => sound.register(r)),
      latched: sound.latched,
      recent,
    });
    summary.textContent = view.summary;
    channelCells.forEach((c, i) => {
      const ch = view.channels.at(i);
      if (ch === undefined) return;
      c.chip.textContent = ch.chip;
      c.basic.textContent = ch.basic;
      c.tone.textContent = ch.tone;
      c.pitch.textContent = ch.pitch;
      c.attenuation.textContent = ch.attenuation;
      c.bar.style.width = `${String((ch.level / 15) * 100)}%`;
      c.row.classList.toggle('silent', ch.silent);
      c.row.title = ch.silent ? 'off: attenuation &F' : `level ${String(ch.level)} of 15`;
    });
    latched.textContent = view.latched;
    byteItems.forEach((item, i) => {
      const b = view.bytes.at(i);
      item.hidden = b === undefined;
      item.textContent = b === undefined ? '' : `${b.byte}  ${b.meaning}`;
    });
  }

  return { title: 'Sound', element, refresh };
}
