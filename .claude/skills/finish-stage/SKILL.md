---
name: finish-stage
description: Close out the current BBC Micro emulator build stage. Use when the user says "/finish-stage", "stage done", "mark it complete", or approves a stage that is in review. It runs the verification gate (tests, typecheck, lint, doc completeness, observable outcome), answers questions, then marks the stage done in docs/PROGRESS.md and commits with the user's approval.
argument-hint: "[stage number, optional]"
---

# Finish a build stage

## 1. Identify the stage

- If a stage number was given (`$ARGUMENTS`), use it.
- Otherwise use the stage that is `in review` in `docs/PROGRESS.md`. Fall back to the one `in progress`.
- If you can't find one, tell the user and stop.

## 2. Run the gate checklist

Work through every item and report each one as ✅ or ❌:

- [ ] `npm test` is green. Note any tests that skipped because ROMs or fixtures are missing, and say which files they need.
- [ ] `npm run typecheck` is green.
- [ ] `npm run lint` is green (from Stage 00 onwards).
- [ ] `git diff main...HEAD` plus the uncommitted changes contain no `any`, no `!` non-null assertions, and no uncommented `as` casts.
- [ ] Core code outside `src/web/` doesn't touch the DOM.
- [ ] `docs/stages/NN-slug.md` exists and has every section from `_TEMPLATE.md` filled in, with nothing left as template text.
- [ ] The doc contains at least one mermaid block.
- [ ] Each mermaid block is valid, and no labels contain a bare `&`.
- [ ] **Observable outcome reproduced.** Re-run the "What you can now see" steps yourself, using the CLI demo, or Playwright MCP for browser outcomes. The result must match what the doc says.
- [ ] Every item in the stage's **Build** and **See it** lines from `BUILD-PLAN.md` is present, or its deviation is explained in the doc.

If any item fails, fix it if it's small, or report it. Don't mark the stage `done` with a failing gate unless the user explicitly accepts it. If they do, record the exception in the stage's Notes.

## 3. Learning check-in

Ask the user whether they have questions about the stage, or want anything explained differently. Offer to go over the "check your understanding" answers. Answer any questions before closing.

If the user's questions reveal a gap in the doc, update the doc.

## 4. Close out (only with the user's approval)

1. Update `docs/PROGRESS.md`:
   - Set status to `done`, and tick **Seen?** ✅.
   - Move **Current stage** to the next stage (`not started`).
   - Record any open questions in the parking lot.
2. Stage and commit on the `stage/NN-slug` branch with a message like:
   ```
   Stage NN: <title>

   <2–4 lines: what was built and the observable outcome>
   ```
   Follow any commit attribution instructions in the session context.
3. Ask whether to merge the branch into `main` now. Only merge if the user says yes.
4. Finish by previewing the next stage in two or three lines: what it is, and what they'll see at the end. Mention that `/start-stage` begins it.
