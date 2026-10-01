import {
  addrAbsolute,
  addrAbsoluteX,
  addrAbsoluteY,
  addrImmediate,
  addrIndexedIndirectX,
  addrIndirect,
  addrIndirectIndexedY,
  addrRelative,
  addrZeroPage,
  addrZeroPageX,
  addrZeroPageY,
  MODES,
  type AddressingMode,
} from '../../cpu/addressing';
import { Cpu6502 } from '../../cpu/cpu6502';
import { TestBus } from '../../memory/test-bus';
import { PRESETS, explainAddressing, parseExplorerInput, type ExplorerInput } from './addressing-view-model';

function busWith(writes: Record<number, number>): TestBus {
  const bus = new TestBus();
  for (const [address, value] of Object.entries(writes)) bus.write(Number(address), value);
  return bus;
}

function explain(input: Partial<ExplorerInput> & { mode: AddressingMode }, bus = new TestBus()) {
  return explainAddressing({ operand: 0, a: 0, x: 0, y: 0, pc: 0x0400, ...input }, (address) => bus.read(address));
}

describe('explainAddressing', () => {
  it('implied mode has no effective address', () => {
    const e = explain({ mode: 'implied' });
    expect(e.instruction).toBe('NOP');
    expect(e.bytes).toBe('&0400: EA');
    expect(e.ea).toBeUndefined();
  });

  it('accumulator mode operates on A and has no effective address', () => {
    const e = explain({ mode: 'accumulator', a: 0x81 });
    expect(e.instruction).toBe('ASL A');
    expect(e.ea).toBeUndefined();
    expect(e.result).toContain('&81');
  });

  it('immediate mode: the EA is the operand byte itself, at PC+1', () => {
    const e = explain({ mode: 'immediate', operand: 0x41 });
    expect(e.instruction).toBe('LDA #&41');
    expect(e.bytes).toBe('&0400: A9 41');
    expect(e.ea).toBe(0x0401);
  });

  it('LDA &FF,X with X=&01 wraps to &0000 and flags the wrap step', () => {
    const e = explain({ mode: 'zeroPageX', operand: 0xff, x: 0x01 });
    expect(e.instruction).toBe('LDA &FF,X');
    expect(e.ea).toBe(0x0000);
    expect(e.steps.some((s) => s.warn && s.text.includes('&0000'))).toBe(true);
  });

  it('LDA &7C00,X shows the operand stored low byte first', () => {
    const e = explain({ mode: 'absoluteX', operand: 0x7c00, x: 0x05 });
    expect(e.bytes).toBe('&0400: BD 00 7C');
    expect(e.ea).toBe(0x7c05);
    expect(e.pageCrossed).toBe(false);
    expect(e.cycles).toBe('4 cycles');
  });

  it('a page-crossing LDA &30F8,Y costs 4 + 1 = 5 cycles and explains the wrong-page read', () => {
    const e = explain({ mode: 'absoluteY', operand: 0x30f8, y: 0x10 });
    expect(e.ea).toBe(0x3108);
    expect(e.pageCrossed).toBe(true);
    expect(e.cycles).toBe('4 + 1 (page crossed) = 5 cycles');
    expect(e.steps.some((s) => s.warn && s.text.includes('&3008'))).toBe(true);
  });

  it('LDA (&70),Y follows the pointer at &70/&71, then adds Y', () => {
    const bus = busWith({ 0x70: 0x00, 0x71: 0x7c, 0x7c05: 0x48 });
    const e = explain({ mode: 'indirectIndexedY', operand: 0x70, y: 0x05 }, bus);
    expect(e.instruction).toBe('LDA (&70),Y');
    expect(e.ea).toBe(0x7c05);
    expect(e.result).toBe('EA = &7C05, which holds &48');
    expect(e.cycles).toBe('5 cycles');
  });

  it('JMP (&30FF) shows the NMOS bug reading the high byte from &3000', () => {
    const bus = busWith({ 0x30ff: 0x34, 0x3000: 0x12, 0x3100: 0x56 });
    const e = explain({ mode: 'indirect', operand: 0x30ff }, bus);
    expect(e.ea).toBe(0x1234);
    expect(e.steps.some((s) => s.warn && s.text.includes('&3000') && s.text.includes('&3100'))).toBe(true);
  });

  it('a branch at &0400 with offset &FE targets itself: 2 cycles, or 3 if taken', () => {
    const e = explain({ mode: 'relative', operand: 0xfe });
    expect(e.instruction).toBe('BNE &0400');
    expect(e.bytes).toBe('&0400: D0 FE');
    expect(e.ea).toBe(0x0400);
    expect(e.cycles).toBe('2 cycles not taken, 3 if taken');
  });

  it('a branch that crosses a page costs 4 if taken', () => {
    const e = explain({ mode: 'relative', operand: 0x80 });
    expect(e.ea).toBe(0x0382);
    expect(e.cycles).toBe('2 cycles not taken, 4 if taken (page crossed)');
  });
});

describe('the explorer agrees with the CPU', () => {
  const ADDR: readonly (readonly [AddressingMode, (cpu: Cpu6502) => number])[] = [
    ['immediate', addrImmediate],
    ['zeroPage', addrZeroPage],
    ['zeroPageX', addrZeroPageX],
    ['zeroPageY', addrZeroPageY],
    ['absolute', addrAbsolute],
    ['absoluteX', addrAbsoluteX],
    ['absoluteY', addrAbsoluteY],
    ['indirect', addrIndirect],
    ['indexedIndirectX', addrIndexedIndirectX],
    ['indirectIndexedY', addrIndirectIndexedY],
    ['relative', addrRelative],
  ];

  // Awkward cases on purpose: wraps, crossings and the JMP bug.
  const cases: readonly { operand: number; x: number; y: number; pc: number }[] = [
    { operand: 0x70, x: 0x04, y: 0x05, pc: 0x0400 },
    { operand: 0xff, x: 0x01, y: 0x01, pc: 0x0400 },
    { operand: 0x30ff, x: 0x10, y: 0xff, pc: 0x04f0 },
    { operand: 0xfffe, x: 0x02, y: 0x02, pc: 0xfffd },
    { operand: 0x80, x: 0x80, y: 0x80, pc: 0x0400 },
  ];

  for (const [mode, addr] of ADDR) {
    it(`gives the same EA and page crossing as the CPU for ${mode}`, () => {
      for (const c of cases) {
        const operand = MODES[mode].operandBytes === 1 ? c.operand & 0xff : c.operand;
        const bus = busWith({ 0x00: 0x12, 0x80: 0xf8, 0x81: 0x30, 0x84: 0x99, 0x30ff: 0x34, 0x3000: 0x56, 0xfffe: 0xaa, 0xffff: 0xbb });
        // The operand goes into memory first, in case a pointer overlaps it.
        bus.load(c.pc + 1, [operand & 0xff, operand >> 8].slice(0, MODES[mode].operandBytes));
        const explanation = explainAddressing({ mode, operand, a: 0, x: c.x, y: c.y, pc: c.pc }, (address) => bus.read(address));

        const cpu = new Cpu6502(bus);
        cpu.regs.pc = (c.pc + 1) & 0xffff;
        cpu.regs.x = c.x;
        cpu.regs.y = c.y;
        expect(explanation.ea).toBe(addr(cpu));
        expect(explanation.pageCrossed).toBe(cpu.pageCrossed);
      }
    });
  }
});

describe('parseExplorerInput', () => {
  const fields = { mode: 'absoluteX', operand: '&7C00', a: '00', x: '&05', y: '0', pc: '&0400' };

  it('accepts &, $ and bare hex', () => {
    expect(parseExplorerInput({ ...fields, operand: '$7c00' })).toEqual({
      ok: true,
      input: { mode: 'absoluteX', operand: 0x7c00, a: 0, x: 5, y: 0, pc: 0x400 },
    });
  });

  it('rejects a two-byte operand for a one-byte mode', () => {
    const result = parseExplorerInput({ ...fields, mode: 'zeroPageX', operand: '&7C00' });
    expect(result).toEqual({ ok: false, error: 'Operand must be one byte, &00-&FF' });
  });

  it('rejects an X that is not a byte', () => {
    expect(parseExplorerInput({ ...fields, x: '&100' })).toEqual({ ok: false, error: 'X must be one byte, &00-&FF' });
  });

  it('rejects an unknown mode', () => {
    expect(parseExplorerInput({ ...fields, mode: 'sideways' })).toEqual({ ok: false, error: 'Unknown mode "sideways"' });
  });

  it('ignores the operand field for modes with no operand', () => {
    const result = parseExplorerInput({ ...fields, mode: 'implied', operand: 'nonsense' });
    expect(result.ok).toBe(true);
  });
});

describe('PRESETS', () => {
  it('every preset parses', () => {
    for (const preset of PRESETS) {
      expect(parseExplorerInput(preset.fields).ok).toBe(true);
    }
  });
});
