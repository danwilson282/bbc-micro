// Bruce Clark's decimal mode test, as a 6502 program in our assembler's syntax.
//
// Clark wrote it for his 6502.org tutorial "Decimal Mode" (Appendix B) and
// put it in the public domain; Klaus Dormann ships a copy with switches as
// 6502_decimal_test.a65. This is the NMOS 6502 version (cputype = 0, invalid
// BCD allowed), written out by hand because Dormann's file uses as65 macros
// and if/endif, which our assembler doesn't have. Plain TypeScript `if`s
// pick the flag checks instead.
//
// It runs every ADC and SBC: 2 carries × 256 × 256. For each one it saves the
// real decimal answer, predicts it again with binary instructions only, and
// compares. It stops at the first difference, leaving the evidence in zero page.
//
// One change from Clark: a failure stores 1 in ERROR if ADC was wrong and 2 if
// SBC was (his version stores 1 for both), so the report can say which.

import { assemble } from '../asm/assembler';
import { TestBus } from '../memory/test-bus';
import { Cpu6502 } from './cpu6502';
import { P_C, P_N, P_V, P_Z } from './flags';
import { runToTrap, type TrapResult } from './run-to-trap';
import type { StepFunction } from './singlestep';

/** Clark's zero-page variables, at the addresses his "org 0 / ds 1" layout gives them. */
export const DECIMAL_TEST_ZP = {
  N1: 0x00, // the two numbers being added or subtracted
  N2: 0x01,
  HA: 0x02, // A and P from the same sum done in binary
  HNVZC: 0x03,
  DA: 0x04, // A and P from the real decimal ADC/SBC: the "actual" answer
  DNVZC: 0x05,
  AR: 0x06, // the predicted A
  NF: 0x07, // the predicted flags: N from NF, V from VF, Z from ZF, C from CF
  VF: 0x08,
  ZF: 0x09,
  CF: 0x0a,
  ERROR: 0x0b, // 0 = passed, 1 = ADC failed, 2 = SBC failed
  N1L: 0x0c, // N1 & &0F, N1 & &F0, and the same for N2
  N1H: 0x0d,
  N2L: 0x0e,
  N2H: 0x0f, // 2 bytes: N2 & &F0 at &0F, (N2 & &F0) + &0F at &10
} as const;

/** Where the code is assembled ("org $200"). */
export const DECIMAL_TEST_START = 0x0200;
/** Enough for the ≈ 54 million cycles it takes, with room to spare. */
export const DECIMAL_TEST_CYCLE_LIMIT = 200_000_000;

/** Which flags to compare. A and C are always checked: they're the documented results. */
export interface DecimalChecks {
  readonly n: boolean;
  readonly v: boolean;
  readonly z: boolean;
}

/** Clark's own setting, right for the NMOS 6502 in the BBC: every flag must match. */
export const ALL_FLAGS: DecimalChecks = { n: true, v: true, z: true };
/** Dormann's default: only the documented results, A and C. */
export const A_AND_C_ONLY: DecimalChecks = { n: false, v: false, z: false };

/** The program's source text, checking the chosen flags. */
export function decimalTestSource(checks: DecimalChecks): string {
  const constants = Object.entries(DECIMAL_TEST_ZP).map(
    ([name, address]) => `${name.padEnd(6)}= &${address.toString(16).toUpperCase().padStart(2, '0')}`,
  );
  const check = (enabled: boolean, lines: string): string => (enabled ? lines : '');
  return `; Bruce Clark's decimal mode test (public domain), NMOS 6502 version.
; See src/cpu/decimal-test.ts. Checks A, C${checks.n ? ', N' : ''}${checks.v ? ', V' : ''}${checks.z ? ', Z' : ''}.

${constants.join('\n')}

        *= &${DECIMAL_TEST_START.toString(16).toUpperCase().padStart(4, '0')}
TEST:   LDY #1          ; Y = carry in: 1 for the first pass, then 0
        STY ERROR       ; ERROR = 1 until the test passes
        LDA #0
        STA N1
        STA N2
LOOP1:  LDA N2          ; N2L = N2 & &0F
        AND #&0F
        STA N2L
        LDA N2          ; N2H = N2 & &F0
        AND #&F0
        STA N2H
        ORA #&0F        ; N2H+1 = (N2 & &F0) + &0F
        STA N2H+1
LOOP2:  LDA N1          ; N1L = N1 & &0F
        AND #&0F
        STA N1L
        LDA N1          ; N1H = N1 & &F0
        AND #&F0
        STA N1H
        JSR ADD
        JSR A6502
        JSR COMPARE
        BNE ADDBAD
        JSR SUB
        JSR S6502
        JSR COMPARE
        BNE SUBBAD
        INC N1          ; all 256 values of N1
        BNE LOOP2
        INC N2          ; all 256 values of N2
        BNE LOOP1
        DEY             ; both values of the carry
        BPL LOOP1
        LDA #0          ; passed: ERROR = 0
        STA ERROR
DONE:   JMP DONE        ; the trap: PC stops here, pass or fail
ADDBAD: LDA #1          ; ours, not Clark's: 1 = ADC was wrong
        STA ERROR
        JMP DONE
SUBBAD: LDA #2          ; 2 = SBC was wrong
        STA ERROR
        JMP DONE

; The real decimal ADC, the same ADC in binary, then the prediction
; worked out in binary: AR (A), CF (carry), VF (P, for N and V).
ADD:    SED             ; decimal mode
        CPY #1          ; C = 1 if Y = 1, C = 0 if Y = 0
        LDA N1
        ADC N2
        STA DA          ; actual A in decimal mode
        PHP
        PLA
        STA DNVZC       ; actual flags in decimal mode
        CLD             ; binary mode
        CPY #1
        LDA N1
        ADC N2
        STA HA          ; A from the binary sum
        PHP
        PLA
        STA HNVZC       ; flags from the binary sum
        CPY #1
        LDA N1L         ; the low digits, plus the carry
        ADC N2L
        CMP #&0A
        LDX #0
        BCC A1
        INX
        ADC #5          ; past 9: add 6 (C is 1, so 5 + C)
        AND #&0F
        SEC
A1:     ORA N1H
        ADC N2H,X       ; the high digits, + &10 more if the low digit carried
        PHP             ; P here has the NMOS decimal N and V
        BCS A2
        CMP #&A0
        BCC A3
A2:     ADC #&5F        ; past 9: add &60 (C is 1, so &5F + C)
        SEC
A3:     STA AR          ; predicted A
        PHP
        PLA
        STA CF          ; predicted C
        PLA
        STA VF          ; predicted N and V
        RTS

; The real decimal SBC, then the same SBC in binary.
SUB:    SED
        CPY #1
        LDA N1
        SBC N2
        STA DA
        PHP
        PLA
        STA DNVZC
        CLD
        CPY #1
        LDA N1
        SBC N2
        STA HA
        PHP
        PLA
        STA HNVZC
        RTS

; The predicted A for SBC, worked out in binary.
SUB1:   CPY #1
        LDA N1L
        SBC N2L
        LDX #0
        BCS S11
        INX
        SBC #5          ; borrowed: subtract 6 (C is 0, so 5 + 1)
        AND #&0F
        CLC
S11:    ORA N1H
        SBC N2H,X
        BCS S12
        SBC #&5F        ; borrowed: subtract &60
S12:    STA AR
        RTS

; COMPARE: Z = 1 if every checked result matches the prediction.
COMPARE: LDA DA
        CMP AR
        BNE C1
${check(checks.n, `        LDA DNVZC       ; N
        EOR NF
        AND #&80
        BNE C1
`)}${check(checks.v, `        LDA DNVZC       ; V
        EOR VF
        AND #&40
        BNE C1
`)}${check(checks.z, `        LDA DNVZC       ; Z
        EOR ZF
        AND #&02
        BNE C1
`)}        LDA DNVZC       ; C
        EOR CF
        AND #&01
C1:     RTS

; The NMOS 6502's rules for the flags in decimal mode.
; ADC: N and V from the half-fixed sum (VF), Z from the binary sum.
A6502:  LDA VF
        STA NF
        LDA HNVZC
        STA ZF
        RTS
; SBC: every flag as in binary.
S6502:  JSR SUB1
        LDA HNVZC
        STA NF
        STA VF
        STA ZF
        STA CF
        RTS
`;
}

export interface DecimalTestResult {
  readonly passed: boolean;
  readonly trap: TrapResult;
  /** 0 passed, 1 ADC failed, 2 SBC failed. */
  readonly error: number;
  /** The failing case, read from zero page: meaningful only when error ≠ 0. */
  readonly n1: number;
  readonly n2: number;
  readonly carryIn: boolean;
  readonly actualA: number;
  readonly predictedA: number;
  /** The real P after the decimal ADC/SBC. */
  readonly actualP: number;
  /** The predicted N, V, Z and C, gathered into one byte (other bits 0). */
  readonly predictedP: number;
}

/** Assembles the test, runs it on a flat 64K bus and reads the verdict from zero page. */
export function runDecimalTest(checks: DecimalChecks, step?: StepFunction): DecimalTestResult {
  const assembly = assemble(decimalTestSource(checks));
  if (!assembly.ok) {
    throw new Error(`the decimal test didn't assemble: ${assembly.errors.map((e) => e.message).join('; ')}`);
  }
  const bus = new TestBus();
  for (const line of assembly.lines) bus.load(line.address, line.bytes);
  const cpu = new Cpu6502(bus);
  cpu.regs.pc = DECIMAL_TEST_START;
  const trap = runToTrap(cpu, DECIMAL_TEST_CYCLE_LIMIT, step);
  const zp = (address: number): number => bus.read(address);
  const z = DECIMAL_TEST_ZP;
  const error = zp(z.ERROR);
  return {
    passed: trap.kind === 'trap' && error === 0,
    trap,
    error,
    n1: zp(z.N1),
    n2: zp(z.N2),
    carryIn: cpu.regs.y === 1,
    actualA: zp(z.DA),
    predictedA: zp(z.AR),
    actualP: zp(z.DNVZC),
    predictedP: (zp(z.NF) & P_N) | (zp(z.VF) & P_V) | (zp(z.ZF) & P_Z) | (zp(z.CF) & P_C),
  };
}
