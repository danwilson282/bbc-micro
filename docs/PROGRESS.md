# Progress

Tracks where the build is up to. The `/start-stage` and `/finish-stage` skills keep this file up to date. For what each stage involves, see [`BUILD-PLAN.md`](./BUILD-PLAN.md).

**Current stage:** 06 — Loads (not started)

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
| 06 | Loads | not started | | `stage/06-loads` | [doc](./stages/06-loads.md) | |
| 07 | Stores & transfers | not started | | `stage/07-stores-transfers` | [doc](./stages/07-stores-transfers.md) | |
| 08 | Mini assembler | not started | | `stage/08-assembler` | [doc](./stages/08-assembler.md) | |
| 09 | Increment & decrement | not started | | `stage/09-inc-dec` | [doc](./stages/09-inc-dec.md) | |
| 10 | Binary arithmetic | not started | | `stage/10-binary-arithmetic` | [doc](./stages/10-binary-arithmetic.md) | |
| 11 | Decimal mode | not started | | `stage/11-decimal-mode` | [doc](./stages/11-decimal-mode.md) | |
| 12 | Logic & BIT | not started | | `stage/12-logic-bit` | [doc](./stages/12-logic-bit.md) | |
| 13 | Shifts & rotates | not started | | `stage/13-shifts-rotates` | [doc](./stages/13-shifts-rotates.md) | |
| 14 | Compare, branch & flag ops | not started | | `stage/14-compare-branch-flags` | [doc](./stages/14-compare-branch-flags.md) | |
| 15 | Jumps & the stack | not started | | `stage/15-jumps-stack` | [doc](./stages/15-jumps-stack.md) | |
| 16 | Subroutines | not started | | `stage/16-subroutines` | [doc](./stages/16-subroutines.md) | |
| 17 | Interrupts | not started | | `stage/17-interrupts` | [doc](./stages/17-interrupts.md) | |
| 18 | Disassembler & trace | not started | | `stage/18-disassembler-trace` | [doc](./stages/18-disassembler-trace.md) | |
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
- **Addressing-mode explorer rework** (Stage 05 review): the panel was hard to follow. It should become a cycle-by-cycle table with a **Next cycle** button (one bus read per row, with the Memory panel outlining each byte), spell out "effective address" instead of "EA" (which clashes with the NOP byte `&EA`), and have a **Put it in memory** button so its bytes aren't hypothetical. Good moment: Stage 06, when `LDA` can really be stepped.
