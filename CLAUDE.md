# BBC Micro Emulator

A **BBC Micro Model B** emulator (MOS 1.20, BASIC II, Acorn DFS) written in TypeScript **from first principles**, as a **learning project**.

The purpose is for the user to understand how an emulator works, one piece at a time. **Explaining clearly matters more than finishing quickly.** Claude implements each stage and explains it. The user reviews and approves the stage before the next one starts.

- Full staged plan: [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md), with 52 small stages in 12 parts.
- Where we are: [`docs/PROGRESS.md`](docs/PROGRESS.md).
- Stage write-ups: `docs/stages/NN-slug.md`, following [`docs/stages/_TEMPLATE.md`](docs/stages/_TEMPLATE.md).

## Scope

- **Target:** Model B (32K) with MOS 1.20, BASIC II and Acorn DFS on an 8271. The emulator covers all screen modes (0–7, including teletext), the keyboard, SN76489 sound, and discs (.ssd/.dsd).
- **Out of scope** unless the user adds it: cassette, Econet, Tube/second processors, the Master/B+, and speech.
- **First principles:**
  - No runtime dependencies for emulation logic. Dev dependencies (tooling, testing) are fine.
  - Work from datasheets, the Advanced User Guide, BeebWiki and 6502.org.
  - **Never copy code from other emulators** (jsbeeb, b-em, etc.). They are GPL, and copying them defeats the point of the project. Consult them only to confirm *behaviour* when the documentation is ambiguous, and say so in the stage doc.

## Workflow

- **Work one small stage at a time.** Start or resume with `/start-stage [nn]` and close with `/finish-stage`.
- **Don't build ahead.** Implement only what the current stage lists. If something from a later stage is needed, stub it and note it.
- **Every stage must end in an observable outcome** (CLI demo, workbench panel, screen change or sound), and it must be demonstrated to the user.
- **Write the stage doc's concepts and diagrams before the code.** Finish the rest of the doc afterwards.
- **Keep `docs/PROGRESS.md` current**: status, the "Seen?" tick, notes and open questions.
- **Git:**
  - One branch per stage: `stage/NN-slug`.
  - Commit only when the user asks, or when they approve at `/finish-stage`.
  - Don't merge to `main` without asking.
- **Teaching style:**
  - Explain each design decision and hardware quirk as you meet it.
  - Show real byte values in `&` hex.
  - When the user asks "why?", answer the question and don't just change the code.
  - End each stage with "check your understanding" questions.

## TypeScript rules

- `strict` mode is on and stays on.
- **No `any`.** Not explicit, and not implied. Use `unknown` and narrow it. ESLint enforces this as an error.
- **No non-null assertions (`!`).** Handle `undefined` explicitly.
- **`as` casts only at I/O boundaries** (fetch, JSON fixtures, DOM queries), each with a comment explaining why.
- Exported functions have explicit return types.
- Use `readonly` for fields and arrays that never change after construction.
- Prefer union literal types or `as const` objects for register names, flags and modes. Avoid string enums.
- No classes with hidden global state. Each machine instance is self-contained.

## Emulation conventions

- **Always mask** to hardware width: `& 0xff` for bytes and `& 0xffff` for addresses and words. JS numbers don't wrap on their own.
- Memory is a `Uint8Array`. Devices expose `read(offset)` and `write(offset, value)`.
- **Hex notation:** use `0x` in code, and the BBC's `&` in docs, comments that quote the AUG, and UI.
- **The core is DOM-free and deterministic.** Everything outside `src/web/` must run under Node/Jest, and anything that touches `document`/`window` lives in `src/web/`.
- **The hot path has no per-instruction allocation.** No object literals, closures or arrays created inside `step()`/`tick()`.
- Name constants after the datasheet (e.g. `VIA_IFR = 0x0d`, `CRTC_R0_HORIZONTAL_TOTAL`), with a comment citing the source.
- Timing uses the instruction-stepped model described in `BUILD-PLAN.md` §3: `cpu.step()` returns the cycles taken, then the devices are ticked by that many.

## Testing

- **Test first.** Write the tests next to the code as `src/**/x.test.ts`.
- Test names describe **hardware behaviour**, e.g. `"T1 in free-run mode reloads from the latch and raises IFR bit 6"`.
- CPU instructions are tested for result, every affected flag, PC advance and cycle count.
- **Tests that need ROMs or fixtures skip gracefully** (with a message saying which file is missing) when `roms/` or `test-fixtures/` files are absent. They never fail in that case.
- A stage is not done until all of these are green:
  ```bash
  npm test && npm run typecheck && npm run lint
  ```
- **Playwright:**
  - Use the Playwright MCP (`.mcp.json`) for interactive visual checks (snapshots and screenshots) of the workbench and screen.
  - Add durable checks to `e2e/*.spec.ts` when a stage produces a browser-visible milestone.

## Docs

- Every stage doc follows `docs/stages/_TEMPLATE.md`, including **at least one mermaid diagram** and a "What you can now see" section with reproduction steps.
- Explain the *why*, and cite datasheet or Advanced User Guide sections.
- In mermaid labels, avoid a bare `&` (it has a special meaning). Write addresses as `FE40` or `0xFE40` inside diagrams. Don't use mermaid keywords as node or participant IDs either (`loop`, `end`, `alt`, `opt`, `par`, `note` and so on). Matching is case-insensitive, so `Loop` breaks a sequence diagram. If you can, check diagrams with `npx -y @mermaid-js/mermaid-cli -i x.mmd -o x.svg`.

## Commands

```bash
npm run dev          # Vite dev server (http://localhost:5173)
npm test             # Jest unit tests
npm run test:e2e     # Playwright end-to-end tests
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (added in Stage 00)
npm run demo:<name>  # CLI demos in scripts/ via tsx (added from Stage 00)
```

## Local-only files (gitignored)

- `roms/`: `os12.rom`, `basic2.rom`, `dfs.rom`. These are Acorn copyright, and the user supplies them.
- `discs/`: the user's disc images.
- `test-fixtures/`: CPU test suites downloaded by `scripts/fetch-test-fixtures.sh` (from Stage 19).
