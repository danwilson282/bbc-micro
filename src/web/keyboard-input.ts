// Browser key events → the BBC's key matrix (Stage 34).
//
// Keys go to the BBC only while `element` (the screen) has focus, so the
// workbench's text boxes still get typed into. Click the screen to type.
//
// The browser gets in the way in four ways, each handled here:
//
//   auto-repeat   keydown fires again and again while a key is held. A
//                 switch is just closed, and the MOS does its own repeat,
//                 so repeats are ignored.
//   lost key-ups  if focus goes elsewhere mid-press, the keyup goes there
//                 too, and the BBC key would stick. On blur, let go of all.
//   macOS ⌘       while ⌘ is held macOS sends no keyup for other keys.
//                 ⌘ isn't mapped, and letting go of it lets go of all.
//   shortcuts     Tab, Space, the arrows, F5 and F12 mean something to
//                 the browser. A mapped key's default is prevented (F12
//                 may still open the developer tools in some browsers).

import { isBbcKeyCode, type PcKeyTracker } from './key-map';

/** Listens on element for keys; onChange is called after anything is pressed or released. */
export function attachKeyboardInput(element: HTMLElement, tracker: PcKeyTracker, onChange: () => void): void {
  element.addEventListener('keydown', (event) => {
    if (event.metaKey) return;
    // A repeat of a mapped key is still the BBC's: stop the browser scrolling, but press nothing.
    const mapped = event.repeat ? isBbcKeyCode(event.code) : tracker.keyDown(event.code);
    if (!mapped) return;
    event.preventDefault();
    if (!event.repeat) onChange();
  });
  element.addEventListener('keyup', (event) => {
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      tracker.releaseAll();
      onChange();
      return;
    }
    if (!tracker.keyUp(event.code)) return;
    event.preventDefault();
    onChange();
  });
  const letGo = (): void => {
    tracker.releaseAll();
    onChange();
  };
  element.addEventListener('blur', letGo);
  element.addEventListener('focus', onChange);
}

