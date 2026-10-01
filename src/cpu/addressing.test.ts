import { TestBus } from '../memory/test-bus';
import {
  MODES,
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
  crossesPage,
  indexed,
  jmpIndirectHigh,
  relativeTarget,
  zeroPageIndexed,
  zeroPagePointerHigh,
} from './addressing';
import { Cpu6502 } from './cpu6502';

const PROGRAM = 0x0400;

/**
 * A CPU whose PC sits on the first OPERAND byte at &0401, as if step() had
 * just fetched the opcode at &0400. operand holds the bytes that follow it.
 */
function cpuWithOperand(operand: readonly number[], regs: { x?: number; y?: number } = {}): { cpu: Cpu6502; bus: TestBus } {
  const bus = new TestBus();
  bus.load(PROGRAM + 1, operand);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = PROGRAM + 1;
  cpu.regs.x = regs.x ?? 0;
  cpu.regs.y = regs.y ?? 0;
  return { cpu, bus };
}

describe('pure address arithmetic', () => {
  it('zero-page indexing drops the carry: &FF + &01 = &00, &80 + &FF = &7F', () => {
    expect(zeroPageIndexed(0xff, 0x01)).toBe(0x00);
    expect(zeroPageIndexed(0x80, 0xff)).toBe(0x7f);
    expect(zeroPageIndexed(0x70, 0x05)).toBe(0x75);
  });

  it('absolute indexing is 16-bit and wraps &FFFF + &01 to &0000', () => {
    expect(indexed(0x30f8, 0x10)).toBe(0x3108);
    expect(indexed(0xffff, 0x01)).toBe(0x0000);
  });

  it('a page is crossed exactly when the high byte changes', () => {
    expect(crossesPage(0x30f8, 0x3108)).toBe(true);
    expect(crossesPage(0x3000, 0x30ff)).toBe(false);
    expect(crossesPage(0xffff, 0x0000)).toBe(true);
  });

  it('a zero-page pointer at &FF takes its high byte from &00', () => {
    expect(zeroPagePointerHigh(0x70)).toBe(0x71);
    expect(zeroPagePointerHigh(0xff)).toBe(0x00);
  });

  it('JMP (ind) increments only the pointer low byte: &30FF pairs with &3000 (NMOS bug)', () => {
    expect(jmpIndirectHigh(0x30ff)).toBe(0x3000);
    expect(jmpIndirectHigh(0x020e)).toBe(0x020f);
  });

  it('a relative offset is signed: &0402 + &FE = &0400, &047F + &7F = &04FE, &0000 + &80 wraps to &FF80', () => {
    expect(relativeTarget(0x0402, 0xfe)).toBe(0x0400);
    expect(relativeTarget(0x047f, 0x7f)).toBe(0x04fe);
    expect(relativeTarget(0x0000, 0x80)).toBe(0xff80);
  });
});

describe('the MODES table', () => {
  it('lists all 13 addressing modes', () => {
    expect(Object.keys(MODES)).toHaveLength(13);
  });

  it('gives implied/accumulator 0 operand bytes, the 1-byte modes 1, and absolute/indirect 2', () => {
    expect(MODES.implied.operandBytes).toBe(0);
    expect(MODES.accumulator.operandBytes).toBe(0);
    for (const mode of ['immediate', 'zeroPage', 'zeroPageX', 'zeroPageY', 'indexedIndirectX', 'indirectIndexedY', 'relative'] as const) {
      expect(MODES[mode].operandBytes).toBe(1);
    }
    for (const mode of ['absolute', 'absoluteX', 'absoluteY', 'indirect'] as const) {
      expect(MODES[mode].operandBytes).toBe(2);
    }
  });
});

describe('immediate', () => {
  it('has the operand byte itself as its EA (the address PC points at), and advances PC by 1', () => {
    const { cpu } = cpuWithOperand([0x41]);
    expect(addrImmediate(cpu)).toBe(0x0401);
    expect(cpu.bus.read(0x0401)).toBe(0x41);
    expect(cpu.regs.pc).toBe(0x0402);
    expect(cpu.pageCrossed).toBe(false);
  });
});

describe('zero page', () => {
  it('LDA &70 → &0070, PC +1', () => {
    const { cpu } = cpuWithOperand([0x70]);
    expect(addrZeroPage(cpu)).toBe(0x0070);
    expect(cpu.regs.pc).toBe(0x0402);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDA &70,X with X=&05 → &0075', () => {
    const { cpu } = cpuWithOperand([0x70], { x: 0x05 });
    expect(addrZeroPageX(cpu)).toBe(0x0075);
    expect(cpu.regs.pc).toBe(0x0402);
  });

  it('LDA &FF,X with X=&01 wraps to &0000, not &0100, and is not a page cross', () => {
    const { cpu } = cpuWithOperand([0xff], { x: 0x01 });
    expect(addrZeroPageX(cpu)).toBe(0x0000);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDX &80,Y with Y=&FF wraps to &007F', () => {
    const { cpu } = cpuWithOperand([0x80], { y: 0xff });
    expect(addrZeroPageY(cpu)).toBe(0x007f);
  });

  it('zero page,X ignores Y and zero page,Y ignores X', () => {
    const a = cpuWithOperand([0x10], { x: 0x01, y: 0x02 });
    expect(addrZeroPageX(a.cpu)).toBe(0x0011);
    const b = cpuWithOperand([0x10], { x: 0x01, y: 0x02 });
    expect(addrZeroPageY(b.cpu)).toBe(0x0012);
  });
});

describe('absolute', () => {
  it('LDA &7C00 reads the operand low byte first (00 7C), PC +2', () => {
    const { cpu } = cpuWithOperand([0x00, 0x7c]);
    expect(addrAbsolute(cpu)).toBe(0x7c00);
    expect(cpu.regs.pc).toBe(0x0403);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDA &7C00,X with X=&05 → &7C05, no page cross', () => {
    const { cpu } = cpuWithOperand([0x00, 0x7c], { x: 0x05 });
    expect(addrAbsoluteX(cpu)).toBe(0x7c05);
    expect(cpu.regs.pc).toBe(0x0403);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDA &30F8,X with X=&10 → &3108 and reports a page cross', () => {
    const { cpu } = cpuWithOperand([0xf8, 0x30], { x: 0x10 });
    expect(addrAbsoluteX(cpu)).toBe(0x3108);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('LDA &30F8,Y with Y=&10 → &3108 and reports a page cross', () => {
    const { cpu } = cpuWithOperand([0xf8, 0x30], { y: 0x10 });
    expect(addrAbsoluteY(cpu)).toBe(0x3108);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('LDA &30F0,Y with Y=&0F → &30FF, the last byte of the page, is not a cross', () => {
    const { cpu } = cpuWithOperand([0xf0, 0x30], { y: 0x0f });
    expect(addrAbsoluteY(cpu)).toBe(0x30ff);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDA &FFFF,X with X=&01 wraps the whole address space to &0000 (a page cross)', () => {
    const { cpu } = cpuWithOperand([0xff, 0xff], { x: 0x01 });
    expect(addrAbsoluteX(cpu)).toBe(0x0000);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('clears a stale pageCrossed left by an earlier instruction', () => {
    const { cpu } = cpuWithOperand([0x00, 0x7c]);
    cpu.pageCrossed = true;
    addrAbsolute(cpu);
    expect(cpu.pageCrossed).toBe(false);
  });
});

describe('indirect (JMP only)', () => {
  it('JMP (&020E) reads the target from &020E (low) and &020F (high)', () => {
    const { cpu, bus } = cpuWithOperand([0x0e, 0x02]);
    bus.load(0x020e, [0x00, 0xe0]);
    expect(addrIndirect(cpu)).toBe(0xe000);
    expect(cpu.regs.pc).toBe(0x0403);
  });

  it('JMP (&30FF) takes the high byte from &3000, not &3100 (NMOS page-wrap bug)', () => {
    const { cpu, bus } = cpuWithOperand([0xff, 0x30]);
    bus.write(0x30ff, 0x34);
    bus.write(0x3000, 0x12); // the byte the NMOS 6502 actually uses
    bus.write(0x3100, 0x56); // the byte a "correct" CPU would use
    expect(addrIndirect(cpu)).toBe(0x1234);
  });
});

describe('(indirect,X): index, then follow the pointer', () => {
  it('LDA (&70,X) with X=&04 reads the pointer at &74/&75', () => {
    const { cpu, bus } = cpuWithOperand([0x70], { x: 0x04 });
    bus.load(0x0074, [0x00, 0x7c]);
    expect(addrIndexedIndirectX(cpu)).toBe(0x7c00);
    expect(cpu.regs.pc).toBe(0x0402);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('LDA (&FF,X) with X=&01 wraps the pointer location to &00/&01', () => {
    const { cpu, bus } = cpuWithOperand([0xff], { x: 0x01 });
    bus.load(0x0000, [0x34, 0x12]);
    bus.load(0x0100, [0x99, 0x99]);
    expect(addrIndexedIndirectX(cpu)).toBe(0x1234);
  });

  it('a pointer at &FF (X=0) takes its high byte from &00, not &0100', () => {
    const { cpu, bus } = cpuWithOperand([0xff], { x: 0x00 });
    bus.write(0x00ff, 0x34);
    bus.write(0x0000, 0x12);
    bus.write(0x0100, 0x99);
    expect(addrIndexedIndirectX(cpu)).toBe(0x1234);
  });
});

describe('(indirect),Y: follow the pointer, then index', () => {
  it('LDA (&70),Y with &70/&71 = 00 7C and Y=&05 → &7C05, no page cross', () => {
    const { cpu, bus } = cpuWithOperand([0x70], { y: 0x05 });
    bus.load(0x0070, [0x00, 0x7c]);
    expect(addrIndirectIndexedY(cpu)).toBe(0x7c05);
    expect(cpu.regs.pc).toBe(0x0402);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('pointer &30F8 + Y=&10 → &3108 and reports a page cross', () => {
    const { cpu, bus } = cpuWithOperand([0x70], { y: 0x10 });
    bus.load(0x0070, [0xf8, 0x30]);
    expect(addrIndirectIndexedY(cpu)).toBe(0x3108);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('a pointer at &FF takes its high byte from &00', () => {
    const { cpu, bus } = cpuWithOperand([0xff], { y: 0x00 });
    bus.write(0x00ff, 0x34);
    bus.write(0x0000, 0x12);
    bus.write(0x0100, 0x99);
    expect(addrIndirectIndexedY(cpu)).toBe(0x1234);
  });

  it('pointer &FFFF + Y=&01 wraps to &0000', () => {
    const { cpu, bus } = cpuWithOperand([0x70], { y: 0x01 });
    bus.load(0x0070, [0xff, 0xff]);
    expect(addrIndirectIndexedY(cpu)).toBe(0x0000);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('adds Y, not X', () => {
    const { cpu, bus } = cpuWithOperand([0x70], { x: 0x40, y: 0x01 });
    bus.load(0x0070, [0x00, 0x7c]);
    expect(addrIndirectIndexedY(cpu)).toBe(0x7c01);
  });
});

describe('relative', () => {
  it('measures the offset from the NEXT instruction: BNE at &0400 with &FE targets &0400 itself', () => {
    const { cpu } = cpuWithOperand([0xfe]);
    expect(addrRelative(cpu)).toBe(0x0400);
    expect(cpu.regs.pc).toBe(0x0402);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('a forward offset of &10 from &0402 targets &0412', () => {
    const { cpu } = cpuWithOperand([0x10]);
    expect(addrRelative(cpu)).toBe(0x0412);
    expect(cpu.pageCrossed).toBe(false);
  });

  it('a backward branch out of the page reports a cross: &0402 + &80 (−128) = &0382', () => {
    const { cpu } = cpuWithOperand([0x80]);
    expect(addrRelative(cpu)).toBe(0x0382);
    expect(cpu.pageCrossed).toBe(true);
  });

  it('a forward branch into the next page reports a cross', () => {
    const { cpu } = cpuWithOperand([0x7f]);
    cpu.regs.pc = 0x04f0; // operand at &04F0, next instruction &04F1
    cpu.bus.write(0x04f0, 0x7f);
    expect(addrRelative(cpu)).toBe(0x0570);
    expect(cpu.pageCrossed).toBe(true);
  });
});

describe('operand fetches wrap PC', () => {
  it('an absolute operand straddling &FFFF/&0000 is read from &FFFF then &0000', () => {
    const bus = new TestBus();
    bus.write(0xffff, 0x00);
    bus.write(0x0000, 0x7c);
    const cpu = new Cpu6502(bus);
    cpu.regs.pc = 0xffff;
    expect(addrAbsolute(cpu)).toBe(0x7c00);
    expect(cpu.regs.pc).toBe(0x0001);
  });
});
