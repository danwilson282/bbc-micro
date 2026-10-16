// The CAPS LOCK and SHIFT LOCK LEDs, under the screen (Stage 36).
//
// They show IC32 bits 6 and 7 (0 = lit), so they show exactly what a real
// Model B's LEDs would: whatever the MOS last wrote to the latch, not what
// the MOS thinks the lock state is. The same lights are on the Keyboard
// panel's keycaps; these are here so you can see them while typing.
//
// update() runs every frame, so it only touches the DOM on a change.

export interface LockLeds {
  readonly element: HTMLElement;
  update(capsLock: boolean, shiftLock: boolean): void;
}

function led(name: string): { readonly element: HTMLElement; set(lit: boolean): void } {
  const element = document.createElement('span');
  element.className = 'lock-led';
  element.dataset.led = name;
  const light = document.createElement('span');
  light.className = 'led-light';
  light.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = name;
  element.append(light, label);
  let shown: boolean | undefined;
  return {
    element,
    set(lit) {
      if (lit === shown) return;
      shown = lit;
      element.classList.toggle('lit', lit);
      element.setAttribute('aria-label', `${name} LED ${lit ? 'on' : 'off'}`);
    },
  };
}

export function createLockLeds(): LockLeds {
  const element = document.createElement('span');
  element.className = 'lock-leds';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Keyboard LEDs');
  element.title = 'The keyboard LEDs: IC32 bits 6 and 7, lit when the bit is 0';
  const caps = led('CAPS LOCK');
  const shift = led('SHIFT LOCK');
  element.append(caps.element, shift.element);
  return {
    element,
    update(capsLock, shiftLock) {
      caps.set(capsLock);
      shift.set(shiftLock);
    },
  };
}
