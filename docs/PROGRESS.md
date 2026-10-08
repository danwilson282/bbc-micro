# Progress

Tracks where the build is up to. The `/start-stage` and `/finish-stage` skills keep this file up to date. For what each stage involves, see [`BUILD-PLAN.md`](./BUILD-PLAN.md).

**Current stage:** 19 — Per-opcode validation (not started)

**Status values:**
- `not started`
- `in progress`: code and doc are being written.
- `in review`: built and demonstrated, waiting for your approval.
- `done`: you approved it and it has been committed.

**Seen?** is ticked ✅ once the stage's observable outcome has been demonstrated to you.


## Part 1: Foundations

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 00 | Tooling & conventions | done | ✅ | `stage/00-tooling` | [doc](./stages/00-tooling.md) | ESLint 10 flat config (strictTypeChecked), tsx, demo:hello, h1 heading. `.playwright-mcp/` gitignored. |
| 01 | Numbers the machine speaks | done | ✅ | `stage/01-numbers` | [doc](./stages/01-numbers.md) | `src/util/bits.ts` (+ `isValidBcd`, not in plan), `demo:numbers`. BCD helpers throw `RangeError` on invalid input. `sanity.test.ts` removed. |
| 02 | Memory & the bus | done | ✅ | `stage/02-memory-bus` | [doc](./stages/02-memory-bus.md) | `src/memory/{bus,ram,test-bus}.ts`, `src/util/hexdump.ts`, `demo:hexdump` (ROM steps skip if `roms/` is missing). `Ram` requires a power-of-two size and mirrors. |
| 03 | Workbench shell | done | ✅ | `stage/03-workbench` | [doc](./stages/03-workbench.md) | `src/web/workbench/` (`DebugTarget` with `peek`/`poke`, pure memory view-model, `Panel`/`Workbench`, memory panel with click-to-edit). `window.workbench` console handle. ESLint `no-restricted-globals` enforces the core/web split. |

## Part 2: The 6502 CPU

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 04 | CPU skeleton | done | ✅ | `stage/04-cpu-skeleton` | [doc](./stages/04-cpu-skeleton.md) | `src/cpu/{cpu6502,registers,flags,opcodes}.ts`. Flags stored as six booleans (no B/bit 5). Registers panel with Step / Step ×16 / Reset, and a PC outline in the memory panel (not in plan). Memory panel now opens at `&0400`. `CpuTarget` in `debug-target.ts`. |
| 05 | Addressing modes | done | ✅ | `stage/05-addressing-modes` | [doc](./stages/05-addressing-modes.md) | `src/cpu/addressing.ts` (pure wrap helpers + 11 EA functions, `MODES` table). Page crossing reported via a `cpu.pageCrossed` field (no allocation). Addressing-mode explorer panel with presets; `main.ts` plants example pointers at `&70`, `&FF` and the `&30FF` JMP trap. `e2e/addressing.spec.ts`. Doc gained a "Start here" section after review. Explorer rework parked (see parking lot). |
| 06 | Loads | done | ✅ | `stage/06-loads` | [doc](./stages/06-loads.md) | `src/cpu/instructions/loads.ts` (18 opcodes from one `load(register, mode)` factory), `setNZ` in `flags.ts`, `EFFECTIVE_ADDRESS` in `addressing.ts`, `buildTable(groups)` rejects duplicate opcodes. Playground program now lives in `src/playground/` as a hand-assembled listing (11 loads at `&0400`, then NOPs). New **Program** panel (not in plan) with ▶ at PC and an "edited" marker. `demo:loads` CLI trace (not in plan). `e2e/loads.spec.ts`. Explorer rework stayed parked (your call at stage start). |
| 07 | Stores & transfers | done | ✅ | `stage/07-stores-transfers` | [doc](./stages/07-stores-transfers.md) | `src/cpu/instructions/{stores,transfers}.ts` (13 + 6 opcodes; stores ignore `pageCrossed`, `TXS` is its own function). New core `WriteRecorder` bus (`src/memory/write-recorder.ts`) between CPU and `TestBus`; `playgroundTarget(bus)` now wires it and exposes `writes`. Memory panel marks **written** bytes (blue bar, separate from "changed") plus a clickable "Wrote:" line; `stepMany` clears the log once per run. `buildMemoryView` takes an options object. Playground runs the 20-line stores program by default; `?program=loads` keeps Stage 06's. Shared `src/playground/setup.ts`. `demo:stores`, `e2e/stores.spec.ts`. |
| 08 | Mini assembler | done | ✅ | `stage/08-assembler` | [doc](./stages/08-assembler.md) | `src/asm/{encodings,parse,assembler}.ts`: all 151 documented opcodes as data, two passes, errors collected with line numbers. Also `name = value` constants and `+`/`-` expressions (not in plan). New **Assembler** panel (example picker, Ctrl+Enter). The Program panel now shows the assembled listing. Stage 06/07 programs are examples generated from their hand listings, and a test proves they assemble byte-for-byte the same. Playground set-up moved into `installProgram()` (`setup.ts`). `?program=` now picks an example (default `labels`). `demo:asm` (not in plan). `e2e/assembler.spec.ts`; cpu/stores specs now use `?program=stores`. |
| 09 | Increment & decrement | done | ✅ | `stage/09-inc-dec` | [doc](./stages/09-inc-dec.md) | `src/cpu/instructions/inc-dec.ts` (12 opcodes). INC/DEC go through a private `readModifyWrite(mode, modify)` that models the NMOS **dummy write** (old value, then new: 2 writes per INC/DEC, visible in the Wrote line). Stage 13's memory shifts should export and reuse it. New default example `incdec` (`INCDEC_SOURCE`). `demo:incdec` (not in plan). `e2e/incdec.spec.ts`; `assembler.spec.ts` now opens `?program=labels`. Tests that used `&E8` as "unimplemented" now use `&69`. |
| 10 | Binary arithmetic | done | ✅ | `stage/10-binary-arithmetic` | [doc](./stages/10-binary-arithmetic.md) | `src/cpu/instructions/arithmetic.ts` (16 opcodes). One exported `addWithCarry`; `subtractWithCarry` passes `value ^ 0xff`. Binary only: D is ignored until Stage 11. Exhaustive 131,072-case sweeps for ADC and SBC against integer reference formulas. New default example `arithmetic` (16-bit add, two overflows, 16-bit subtract). With no CLC/SEC until Stage 14, it relies on C=0 after our reset and on an overflowing ADC leaving C=1. `demo:arith` prints the V truth table from real ADCs (not in plan). `e2e/arithmetic.spec.ts`; `incdec.spec.ts` now opens `?program=incdec`. The "unimplemented" tests now use `&29`. |
| 11 | Decimal mode | done | ✅ | `stage/11-decimal-mode` | [doc](./stages/11-decimal-mode.md) | `addDecimal`/`subtractDecimal` in `arithmetic.ts`, picked per instruction by `add`/`subtract` on D. NMOS flags: decimal ADC takes N/V from the half-fixed sum and Z from the binary sum; decimal SBC keeps all the binary flags. Exhaustive sweeps: valid BCD against plain decimal arithmetic, and all 131,072 inputs against Clark's algorithm (6502.org). **SED/CLD brought forward from Stage 14** (your choice) into new `flag-ops.ts`; Stage 14 adds the other five there. New default example `decimal`. `demo:score` (00→99 counter, decimal vs binary, and a quirk table). The script is the loop until branches. `e2e/decimal.spec.ts`; `arithmetic.spec.ts` now opens `?program=arithmetic`. |
| 12 | Logic & BIT | done | ✅ | `stage/12-logic-bit` | [doc](./stages/12-logic-bit.md) | `src/cpu/instructions/logic.ts` (26 opcodes): exported `and`/`or`/`eor`/`bit` ALU functions plus a private `readOperand(mode, alu)` factory (a copy of Stage 10's `arithmetic()`; share it at Stage 14). Exhaustive 65,536-case sweeps against bit-by-bit truth tables, and for BIT. `&89` (65C02 `BIT #`) left empty. Registers panel now shows **A, X and Y in binary** (`formatBinary`, `RegisterBit[]`), highlighting bits that changed (`old ^ new`). New default example `logic`. `demo:logic` (not in plan). `e2e/logic.spec.ts`; `decimal.spec.ts` now opens `?program=decimal`. Tests that used `&29` as "unimplemented" now use `&0A`. |
| 13 | Shifts & rotates | done | ✅ | `stage/13-shifts-rotates` | [doc](./stages/13-shifts-rotates.md) | `src/cpu/instructions/shifts.ts` (20 opcodes): exported `asl`/`lsr`/`rol`/`ror` ALU functions that **return** the result (so one function serves `ASL A` and `ASL &nn`), plus a private `accumulator(alu)`. `readModifyWrite` + `RmwMode` moved from `inc-dec.ts` to new shared `rmw.ts`; its `modify` callback now takes `(regs, value)`. Exhaustive sweeps (256 values × both carries) against a plain-arithmetic reference. New default example `shifts` (23 × 10 by shifts + one ADC, LSR remainders, memory ASL, 16-bit ASL/ROL, a bit walked round the 9-bit ring). Still no CLC: the last ASL leaves C=0. `demo:times10` (16-bit × 10 routine, table plus binary trace). `e2e/shifts.spec.ts`; `logic.spec.ts` now opens `?program=logic`. Tests that used `&0A` as "unimplemented" now use `&C9`. |
| 14 | Compare, branch & flag ops | done | ✅ | `stage/14-compare-branch-flags` | [doc](./stages/14-compare-branch-flags.md) | `compare.ts` (14 opcodes, one `compare(flags, register, value)`), `branches.ts` (8, built from `branch(flag, when)` on Stage 05's `addrRelative`), `flag-ops.ts` now has all 7. 141/151 opcodes. **Shared `readOperand`** moved to `instructions/read-operand.ts` (arithmetic, logic, compare). Exhaustive 65,536-pair compare sweep. New DOM-free `run-model.ts` (`runFor`/`advanceRun`: 40,000 cycles per animation frame, stops *before* BRK `&00`, on unimplemented opcodes, or at 20M cycles). **Run/Stop** button in Registers; `formatCycles` scales to ms/s. New default example `fill` (fills `&7C00`–`&7FFF` A→Z with a wait loop: exactly 8,841,075 cycles, checked by tests). `demo:fill`. `e2e/compare-branch.spec.ts`; `shifts.spec.ts` now opens `?program=shifts`. The labels example's data `50 7C` is now executed as `BVC` (tests updated). "Unimplemented" tests now use `&4C`. Review changes: Registers and Memory moved under the screen (`#under-screen`; `Workbench.add(panel, host?)`), and every panel has a −/+ toggle by its title, remembered in localStorage. 2 new tests in `workbench.spec.ts`. |
| 15 | Jumps & the stack | done | ✅ | `stage/15-jumps-stack` | [doc](./stages/15-jumps-stack.md) | `STACK_PAGE` + `cpu.push`/`cpu.pull` on `Cpu6502` (for Stages 16/17 too). `instructions/stack.ts` (PHA PLA PHP PLP: `packP(regs, true)` / `unpackP`), `instructions/jumps.ts` (JMP abs/ind; the bug stays in `addrIndirect`). 147/151 opcodes. New **Stack** panel under the screen between Registers and Memory (`stack-view-model.ts`: `&01FF` down to S−3, slots used/next-push/free, next-pull mark, hex + binary, changed/written, deep stacks elided to 20 rows). New default example `stack` (pushes/pulls, PHP `&3D`, V via PLP, JMP over a BRK, the `JMP (&10FF)` trap to `&0480`, then a wrap from S=`&00`): 33 instructions, 93 cycles. `demo:stack` (not in plan). `e2e/stack.spec.ts`; `compare-branch.spec.ts` now opens `?program=fill`; `workbench.spec.ts` expects 3 panels under the screen. "Unimplemented" tests now use `&02` (an undocumented JAM opcode) so they stop moving every stage. |
| 16 | Subroutines | done | ✅ | `stage/16-subroutines` | [doc](./stages/16-subroutines.md) | `instructions/subroutines.ts` (JSR, RTS). `jsr` follows the real bus order (low byte, push PCH, push PCL, high byte), so the "PC − 1" falls out with no `- 1` in the code; a test pins the bus log. 149/151 opcodes. Stack panel gains an **RTS now →** hint line (`rts` in `stack-view-model.ts`, not in plan). New default example `subroutines` (8×8 shift-and-add `multiply`, `square` calling it: 143, 144, 30000 at `&90`–`&95`; 202 instructions, 640 cycles). `demo:multiply` call trace. `e2e/subroutines.spec.ts`; `stack.spec.ts` now opens `?program=stack`. |
| 17 | Interrupts | done | ✅ | `stage/17-interrupts` | [doc](./stages/17-interrupts.md) | **151/151 opcodes.** `Cpu6502`: `irq` field (level), `setNmi()` + `nmiPending` (edge latch), `pendingInterrupt`, shared `enterInterrupt(vector, b)`. `step()` checks NMI, then `irq && !i`, before fetching, so an interrupt is a whole 7-cycle step. `reset()` clears the NMI latch (our choice). `instructions/interrupts.ts` (BRK skips its padding byte, B = 1; RTI pulls P then PC, no + 1). New playground-only **doorbell** device at `&FC00` (FRED): IRQ button rings it, any write answers it (`src/playground/doorbell.ts`). The playground target is now CPU → WriteRecorder → Doorbell → TestBus, and copies the doorbell's line to `cpu.irq` after each step (`InterruptTarget`: `ringIrq`/`pulseNmi`). New **Interrupts** panel under the screen after Registers (inputs in words, next-step verdict, vectors). Registers' Next line names a due IRQ/NMI. Run now continues through a BRK it starts on, and doesn't stop at a BRK when an interrupt is due. New default example `interrupts` (BRK/IRQ told apart by the pushed B, counters at `&80`–`&85`). `demo:interrupts` timeline. `e2e/interrupts.spec.ts`; `subroutines.spec.ts` now opens `?program=subroutines`; `workbench.spec.ts` expects 4 panels under the screen; `cpu.spec.ts` steps through the BRK at `&0500` to `&0000`. |
| 18 | Disassembler & trace | done | ✅ | `stage/18-disassembler-trace` | [doc](./stages/18-disassembler-trace.md) | `src/cpu/disassembler.ts` (`disassemble`/`disassembleRange` over a `Peek`, reusing `OPCODES` + `MODES`; output is assembler syntax; optional address → name `Labels`; undocumented bytes print as `.byte &nn`). All 151 opcodes checked against the assembler's independent `ENCODINGS` and round-tripped. `src/cpu/trace.ts`: `Tracer` ring buffer (typed arrays, power-of-two capacity, default 1,024), `record(cpu)` before each step stores the state *before* it, plus the bytes at PC at that moment (so self-modified code shows each version); IRQ/NMI steps recorded as such. `formatTraceLine`/`TRACE_HEADER`/`formatFlags` (`nv--dIzc`). The CPU itself is untouched. `playgroundTarget` is now a `TracedTarget` (records before every step, clears on reset). New **Disassembly** panel after Program: "Just ran" (last 6 trace entries, struck through if memory changed since) and "Coming up" (12 lines from PC, or from a Go address with Follow PC off). `workbench.trace(n)` console helper. New default example `trace` (BIT-skip two entry points, self-modifying `STA`: 29 steps, 105 cycles). `demo:trace` (full trace + a bug hunt: diffing traces of a planted `ROR A` bug finds it at step 160 of 202). `e2e/disassembly.spec.ts`; `interrupts.spec.ts` now opens `?program=interrupts`. |
| 19 | Per-opcode validation | not started | | `stage/19-singlestep-validation` | [doc](./stages/19-singlestep-validation.md) | |
| 20 | Whole-CPU validation & speed | not started | | `stage/20-functional-validation` | [doc](./stages/20-functional-validation.md) | |

## Part 3: BBC memory map & ROMs

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 21 | Memory map & I/O dispatch | not started | | `stage/21-memory-map` | [doc](./stages/21-memory-map.md) | |
| 22 | ROMs & sideways paging | not started | | `stage/22-roms-sideways` | [doc](./stages/22-roms-sideways.md) | |
| 23 | First steps into the MOS | not started | | `stage/23-mos-first-steps` | [doc](./stages/23-mos-first-steps.md) | |

## Part 4: The 6522 VIA

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 24 | VIA ports & registers | not started | | `stage/24-via-ports` | [doc](./stages/24-via-ports.md) | |
| 25 | VIA timers | not started | | `stage/25-via-timers` | [doc](./stages/25-via-timers.md) | |
| 26 | VIA interrupts & control lines | not started | | `stage/26-via-interrupts` | [doc](./stages/26-via-interrupts.md) | |

## Part 5: Assembling the machine

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 27 | Machine & scheduler | not started | | `stage/27-machine-scheduler` | [doc](./stages/27-machine-scheduler.md) | |
| 28 | Addressable latch & peripheral stubs | not started | | `stage/28-latch-stubs` | [doc](./stages/28-latch-stubs.md) | |
| 29 | First boot | not started | | `stage/29-first-boot` | [doc](./stages/29-first-boot.md) | |

## Part 6: Mode 7 on screen

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 30 | Browser run loop | not started | | `stage/30-run-loop` | [doc](./stages/30-run-loop.md) | |
| 31 | Teletext font & canvas | not started | | `stage/31-teletext-font` | [doc](./stages/31-teletext-font.md) | |
| 32 | Teletext colours & graphics | not started | | `stage/32-teletext-colour-graphics` | [doc](./stages/32-teletext-colour-graphics.md) | |
| 33 | Double height, flash & conceal | not started | | `stage/33-teletext-double-height-flash` | [doc](./stages/33-teletext-double-height-flash.md) | |

## Part 7: Keyboard

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 34 | Key matrix & PC mapping | not started | | `stage/34-key-matrix` | [doc](./stages/34-key-matrix.md) | |
| 35 | Scanning & keyboard interrupts | not started | | `stage/35-keyboard-scanning` | [doc](./stages/35-keyboard-scanning.md) | |
| 36 | Modifiers, BREAK & LEDs | not started | | `stage/36-modifiers-break-leds` | [doc](./stages/36-modifiers-break-leds.md) | |

## Part 8: The 6845 CRTC

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 37 | CRTC registers & geometry | not started | | `stage/37-crtc-registers` | [doc](./stages/37-crtc-registers.md) | |
| 38 | CRTC counters & sync | not started | | `stage/38-crtc-counters-sync` | [doc](./stages/38-crtc-counters-sync.md) | |
| 39 | CRTC addressing, scrolling & cursor | not started | | `stage/39-crtc-addressing-cursor` | [doc](./stages/39-crtc-addressing-cursor.md) | |

## Part 9: Video ULA & bitmap modes

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 40 | ULA control & palette | not started | | `stage/40-ula-palette` | [doc](./stages/40-ula-palette.md) | |
| 41 | Pixel decoding | not started | | `stage/41-pixel-decoding` | [doc](./stages/41-pixel-decoding.md) | |
| 42 | Rendering modes 0–6 | not started | | `stage/42-bitmap-rendering` | [doc](./stages/42-bitmap-rendering.md) | |
| 43 | Wrap-around & graphics | not started | | `stage/43-wraparound-graphics` | [doc](./stages/43-wraparound-graphics.md) | |

## Part 10: Sound

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 44 | SN76489 register protocol | not started | | `stage/44-sn76489-registers` | [doc](./stages/44-sn76489-registers.md) | |
| 45 | Tone & noise generation | not started | | `stage/45-tone-noise` | [doc](./stages/45-tone-noise.md) | |
| 46 | Web Audio output | not started | | `stage/46-web-audio` | [doc](./stages/46-web-audio.md) | |

## Part 11: Disc

| # | Stage | Status | Seen? | Branch | Doc | Notes |
|---|---|---|---|---|---|---|
| 47 | Disc image geometry | not started | | `stage/47-disc-geometry` | [doc](./stages/47-disc-geometry.md) | |
| 48 | DFS catalogue | not started | | `stage/48-dfs-catalogue` | [doc](./stages/48-dfs-catalogue.md) | |
| 49 | 8271 registers & commands | not started | | `stage/49-fdc-commands` | [doc](./stages/49-fdc-commands.md) | |
| 50 | 8271 data transfer & NMI | not started | | `stage/50-fdc-data-nmi` | [doc](./stages/50-fdc-data-nmi.md) | |
| 51 | Running software | not started | | `stage/51-running-software` | [doc](./stages/51-running-software.md) | |

## Part 12: Optional extras

Pick from the menu in BUILD-PLAN.md §8 once Part 11 is done, and add a row here for each extra you start.

## Open questions / parking lot

Things to come back to: questions raised during a stage, known inaccuracies, ideas.

- `typescript-eslint` supports TypeScript `<6.1.0`. Watch for this if TypeScript is upgraded.
- Side-effect-free `peek(address)` for debug views: `hexdump` goes through `read()`, which would trigger device side effects on SHEILA. Needed once the workbench shows I/O memory (Stage 21+). (Stage 02) The workbench side is done: panels use `DebugTarget.peek` (Stage 03). The memory map still needs a real `peek`.
- Workbench `refresh()` rebuilds the whole table. Measure it once it runs every frame (Stage 30), and switch to text-only updates if it's slow. (Stage 03)
- Dummy bus reads (e.g. the page-crossing read in `abs,X`, NOP's second cycle, and reset's three stack reads (Stage 04)) aren't modelled by the instruction-stepped core. Revisit with the cycle-exact extras in Part 12. (Stage 02)
- **Addressing-mode explorer rework** (Stage 05 review): the panel was hard to follow. It should become a cycle-by-cycle table with a **Next cycle** button (one bus read per row, with the Memory panel outlining each byte), spell out "effective address" instead of "EA" (which clashes with the NOP byte `&EA`), and have a **Put it in memory** button so its bytes aren't hypothetical. Good moment: Stage 06, when `LDA` can really be stepped. (Deferred again at Stage 06 to keep the stage small.)
- The indexed RMW modes' dummy read (`INC &nn,X` reads `&nn` first; `INC &nnnn,X` reads the un-fixed address) isn't modelled either. The RMW dummy *write* is modelled (Stage 09). (Stage 09)
- Indexed stores' cycle-4 dummy read (e.g. `STA &FE3F,X` reads `&FE44` before writing it) is a real bus read with side effects on SHEILA. Not modelled; belongs with the dummy-read item above. (Stage 07)
- ~~Program selection is a bare `?program=` query string.~~ Done in Stage 08: the Assembler panel has an example picker, and `?program=` picks the initial example.
- Assembler features not built yet: strings in `.byte`, `*` as the current address, `<`/`>` low/high byte, and the undocumented opcodes. Add them when a stage needs them. (Stage 08)
- After Assemble & Run, the Registers panel highlights S/PC/P as "changed" because the reset happens after the first draw. It's harmless, but noisy on page load. (Stage 08)
- Registers panel reads A as binary only (`&60` → "96 / 96"). It might show the BCD reading as well when D is set. (Stage 11)
- Invalid-BCD results follow Clark's tutorial. Cross-check them against the real-hardware data in Stage 19. (Stage 11)
- ~~`readOperand` (logic.ts) and `arithmetic()` (arithmetic.ts) are the same factory.~~ Done in Stage 14: `instructions/read-operand.ts`.
- Run runs 40,000 cycles per *browser* frame, so it's ~1.2× real speed on a 60 Hz display (more on 120 Hz). Stage 30's run loop should pace by wall-clock time. (Stage 14)
- NMOS quirk: a taken branch that doesn't cross a page delays IRQ/NMI recognition by one instruction. Explained but not modelled in Stage 17; Part 12 cycle-exact extras. (Stage 14)
- NMOS quirk: `PLP`, `CLI` and `SEI` change I one instruction late as far as IRQ recognition goes (`RTI` doesn't). Explained but not modelled in Stage 17 (ours takes an IRQ straight after `CLI`); Part 12 cycle-exact extras. (Stage 15)
- Interrupt hijacking (an NMI during a BRK's or an IRQ's first cycles takes over the sequence: `&FFFA` with B = 1, and the BRK is lost) can't happen with interrupts only between whole instructions. Part 12. BRK's and RTI's dummy reads aren't modelled either. (Stage 17)
- What does the real 6502 do with a latched NMI across RESET? We clear it. Unconfirmed. (Stage 17)
- The `&FC00` doorbell is a playground-only stand-in for an IRQ source. It goes when the playground does (Part 5); the System VIA's IFR at `&FE4D` is the real acknowledge. (Stage 17)
- Check in Part 3: is the bottom of page 1 really used to hold error messages copied from sideways ROMs (so the stack must never get that deep)? Stated as unconfirmed in the Stage 15 doc. (Stage 15)
- PHA/PHP/PLA/PLP dummy reads (cycle 2 reads the next byte; pulls' cycle 3 reads the stack at the old S) aren't modelled. They belong with the other dummy reads. (Stage 15)
- `JSR`'s cycle-3 dummy stack read and `RTS`'s dummy reads (cycles 2, 3, 6) aren't modelled. They belong with the other dummy reads. (Stage 16)
- Assembler always picks zero page for values < &100, so `AD 70 00` (LDA &0070, absolute) disassembles but doesn't round-trip (it reassembles as `A5 70`). A "force absolute" operand syntax would fix it. (Stage 18)
- The disassembler only names exact label addresses: `INC store+1` shows as `INC &040E`. Label+offset is possible but a guess. (Stage 18)
- The disassembler treats every undocumented opcode as 1 byte; real NMOS lengths vary (`&04` is a 2-byte NOP). Revisit with the undocumented opcodes (Stage 19 / Part 12). (Stage 18)
- Idea: trace lines could show the effective address and the value there (`LDA (&70),Y  = &7C05: &41`), as many debuggers do. Not built. (Stage 18)
- The cost of tracing every step during Run hasn't been measured. Check it with Stage 20's benchmark, and consider tracing only on demand for long runs. (Stage 18)
- Undocumented `SBC #` duplicate at `&EB` isn't implemented. Part 12 extras. (Stage 10)
- Undocumented NMOS opcodes that also load registers (`LAX` `&A7`/`&AF`/…) aren't implemented. They belong with the optional extras in Part 12. (Stage 06)
