import { BBC_KEYS, Keyboard, bbcKey } from '../devices/keyboard';
import { BREAK_PC_CODES, PC_KEY_MAP, PcKeyTracker, isBbcKeyCode, pcKeysFor, type BreakSwitch } from './key-map';

/** The BBC key name a PC code closes, for readable expectations. */
function bbcNameFor(code: string): string | undefined {
  const key = PC_KEY_MAP.get(code);
  return key === undefined ? undefined : bbcKey(key)?.name;
}

describe('PC_KEY_MAP: KeyboardEvent.code → BBC switch, by position', () => {
  it.each([
    ['KeyA', 'A'], ['KeyZ', 'Z'], ['Digit1', '1'], ['Digit0', '0'],
    ['Escape', 'ESCAPE'], ['Tab', 'TAB'], ['CapsLock', 'CAPS LOCK'], ['Enter', 'RETURN'], ['Space', 'SPACE'],
    ['ShiftLeft', 'SHIFT'], ['ShiftRight', 'SHIFT'], ['ControlLeft', 'CTRL'], ['ControlRight', 'CTRL'],
    ['ArrowLeft', 'LEFT'], ['ArrowRight', 'RIGHT'], ['ArrowUp', 'UP'], ['ArrowDown', 'DOWN'],
    ['Backspace', 'DELETE'], ['Delete', 'DELETE'], ['End', 'COPY'],
  ])('%s closes the BBC %s switch', (code, name) => {
    expect(bbcNameFor(code)).toBe(name);
  });

  it.each([
    ['Equal', '^'], ['BracketLeft', '@'], ['BracketRight', '['], ['Quote', ':'], ['Backslash', ']'],
    ['IntlBackslash', '\\'], ['Backquote', '_'],
  ])('punctuation goes by place, not symbol: PC %s is BBC %s', (code, name) => {
    expect(bbcNameFor(code)).toBe(name);
  });

  it('so PC SHIFT + the key after ; gives BBC SHIFT + : , which the BBC prints as *', () => {
    const key = PC_KEY_MAP.get('Quote');
    expect(key === undefined ? undefined : bbcKey(key)?.shifted).toBe('*');
  });

  it('F1-F9 are f1-f9 and F10 is f0, by the number on the key', () => {
    for (let n = 1; n <= 9; n++) expect(bbcNameFor(`F${String(n)}`)).toBe(`f${String(n)}`);
    expect(bbcNameFor('F10')).toBe('f0');
  });

  it('every BBC key except SHIFT LOCK has at least one PC key', () => {
    const unmapped = BBC_KEYS.filter((k) => pcKeysFor(k.key).length === 0).map((k) => k.name);
    expect(unmapped).toEqual(['SHIFT LOCK']);
  });

  it('does not map the Mac Cmd keys, Alt, or F12 into the matrix (F12 is BREAK, which is not on the matrix)', () => {
    for (const code of ['MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'F12', 'Pause']) expect(PC_KEY_MAP.has(code)).toBe(false);
  });

  it('F12 and Pause (the PC\'s Pause/Break key) are BREAK (Stage 36), and count as BBC keys', () => {
    expect([...BREAK_PC_CODES]).toEqual(['F12', 'Pause']);
    expect([isBbcKeyCode('F12'), isBbcKeyCode('Pause'), isBbcKeyCode('KeyA'), isBbcKeyCode('AltLeft')]).toEqual([true, true, true, false]);
  });

  it('pcKeysFor lists the PC keys for a BBC key, as a person would name them', () => {
    expect(pcKeysFor(0x00)).toEqual(['Shift']); // both shifts, named once
    expect(pcKeysFor(0x59)).toEqual(['Backspace', 'Delete']);
    expect(pcKeysFor(0x48)).toEqual(["'"]);
  });
});

describe('PcKeyTracker: PC key presses → BBC switches', () => {
  it('a mapped key down presses the BBC key, and up releases it', () => {
    const kb = new Keyboard();
    const pc = new PcKeyTracker(kb);
    expect(pc.keyDown('KeyA')).toBe(true);
    expect(kb.isDown(0x41)).toBe(true);
    expect(pc.keyUp('KeyA')).toBe(true);
    expect(kb.isDown(0x41)).toBe(false);
  });

  it('an unmapped key is ignored and says so (false), so the browser keeps it', () => {
    const kb = new Keyboard();
    const pc = new PcKeyTracker(kb);
    expect(pc.keyDown('MetaLeft')).toBe(false);
    expect(pc.keyUp('MetaLeft')).toBe(false);
  });

  it('both PC Shifts are one BBC SHIFT: it stays down until the last one is let go', () => {
    const kb = new Keyboard();
    const pc = new PcKeyTracker(kb);
    pc.keyDown('ShiftLeft');
    pc.keyDown('ShiftRight');
    pc.keyUp('ShiftLeft');
    expect(kb.isDown(0x00)).toBe(true);
    pc.keyUp('ShiftRight');
    expect(kb.isDown(0x00)).toBe(false);
  });

  it('a key-up with no key-down (focus came back mid-press) releases nothing it did not press', () => {
    const kb = new Keyboard();
    const pc = new PcKeyTracker(kb);
    kb.press(0x41); // pressed by someone else: a panel click
    pc.keyUp('KeyA');
    expect(kb.isDown(0x41)).toBe(true);
  });

  it('releaseAll lets go of everything it pressed (a lost focus), but not panel presses', () => {
    const kb = new Keyboard();
    const pc = new PcKeyTracker(kb);
    pc.keyDown('KeyA');
    pc.keyDown('ShiftLeft');
    kb.press(0x50); // SHIFT LOCK, clicked in the panel
    pc.releaseAll();
    expect([kb.isDown(0x41), kb.isDown(0x00), kb.isDown(0x50)]).toEqual([false, false, true]);
  });
});

describe('PcKeyTracker: BREAK (Stage 36)', () => {
  /** A BREAK switch that remembers every change it was told about. */
  function breakSwitch(): BreakSwitch & { readonly changes: boolean[] } {
    const changes: boolean[] = [];
    return {
      changes,
      setBreak(down) {
        changes.push(down);
      },
    };
  }

  it('F12 down holds BREAK, and F12 up lets go: the switch, not the matrix', () => {
    const kb = new Keyboard();
    const brk = breakSwitch();
    const pc = new PcKeyTracker(kb, brk);
    expect(pc.keyDown('F12')).toBe(true);
    expect(brk.changes).toEqual([true]);
    expect(BBC_KEYS.some((k) => kb.isDown(k.key))).toBe(false);
    expect(pc.keyUp('F12')).toBe(true);
    expect(brk.changes).toEqual([true, false]);
  });

  it('F12 and Pause are one BREAK: it is let go only when the last of them comes up', () => {
    const brk = breakSwitch();
    const pc = new PcKeyTracker(new Keyboard(), brk);
    pc.keyDown('F12');
    pc.keyDown('Pause');
    pc.keyUp('F12');
    expect(brk.changes).toEqual([true]);
    pc.keyUp('Pause');
    expect(brk.changes).toEqual([true, false]);
  });

  it('with no BREAK switch wired, F12 is left to the browser (false)', () => {
    const pc = new PcKeyTracker(new Keyboard());
    expect(pc.keyDown('F12')).toBe(false);
  });

  it('releaseAll lets go of BREAK too (a lost focus would leave the CPU held for ever)', () => {
    const kb = new Keyboard();
    const brk = breakSwitch();
    const pc = new PcKeyTracker(kb, brk);
    pc.keyDown('ControlLeft');
    pc.keyDown('F12');
    pc.releaseAll();
    expect(brk.changes).toEqual([true, false]);
    expect(kb.isDown(0x01)).toBe(false);
  });
});
