// The sound switch under the screen (Stage 46): a 🔇/🔊 button and a line
// saying what the audio thread is doing. Sound starts off because browsers
// only allow audio after a click (autoplay rules); this button is that click.

import { button } from '../workbench/dom';
import type { AudioOutput } from './audio-output';
import { audioStatusText } from './audio-status';

export interface SoundControl {
  readonly element: HTMLElement;
  /** Redraws from the output's latest stats. */
  update(): void;
}

export function createSoundControl(audio: AudioOutput): SoundControl {
  const element = document.createElement('span');
  element.className = 'sound-control';
  // Its own group, beside the Machine controls: one status line per group.
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Sound');
  const toggle = button('', '');
  toggle.dataset.field = 'sound';
  const status = document.createElement('span');
  status.className = 'sound-status';
  status.setAttribute('role', 'status');
  element.append(toggle, status);

  let error: string | undefined;

  function update(): void {
    toggle.textContent = audio.on ? '🔊 Sound on' : '🔇 Sound off';
    toggle.setAttribute('aria-label', audio.on ? 'Switch sound off' : 'Switch sound on');
    toggle.setAttribute('aria-pressed', String(audio.on));
    status.classList.toggle('error', error !== undefined);
    status.textContent = error ?? (audio.on ? audioStatusText(audio.stats) : 'browsers need a click before any sound');
  }

  toggle.addEventListener('click', () => {
    error = undefined;
    const change = audio.on ? audio.switchOff() : audio.switchOn();
    update();
    change.then(update, (e: unknown) => {
      error = `No sound: ${e instanceof Error ? e.message : String(e)}`;
      update();
    });
  });

  update();
  return { element, update };
}
