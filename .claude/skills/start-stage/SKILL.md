---
name: start-stage
description: Start or resume a stage of the BBC Micro emulator build plan. Use when the user says "/start-stage", "next stage", "start stage NN", "carry on with the emulator", or asks to continue the build. It picks the stage from docs/PROGRESS.md, writes the stage doc (concepts and diagrams first), implements the stage test-first, builds its observable outcome, and hands over for review.
argument-hint: "[stage number, e.g. 05]"
---

# Start (or resume) a build stage

This is a **learning project** (see `CLAUDE.md`). Your job is to implement one small stage *and teach it*. Work through the steps in order.

## 1. Find the stage

1. Read `docs/PROGRESS.md` and `docs/BUILD-PLAN.md`.
2. If an argument was given (`$ARGUMENTS`), use that stage number.
3. Otherwise:
   - If a stage is `in progress`, resume it.
   - If a stage is `in review`, remind the user and suggest `/finish-stage` before starting anything new. Stop there unless they say to continue.
   - Otherwise pick the lowest-numbered stage that is `not started`.
4. Check the stage's **Needs** in `BUILD-PLAN.md`. If any prerequisite is not `done`, tell the user which one, and ask before continuing.

## 2. Get oriented

1. Read the stage's section of `BUILD-PLAN.md` carefully. Note its Learn, Build, Tests and See it points.
2. Skim the docs of the previous one or two stages, and the code they produced, so the new work fits the existing interfaces.
3. If resuming, read the existing stage doc and `git diff main...HEAD` to see what's already done.
4. Give the user a short summary: what this stage is, what they'll learn, and what they'll be able to *see* at the end.

## 3. Branch and track

1. Check `git status`. If there are uncommitted changes that don't belong to this stage, ask the user what to do before switching branches.
2. Create or switch to `stage/NN-slug` (the branch name is in `PROGRESS.md`).
3. In `PROGRESS.md`, set the stage to `in progress` and update the **Current stage** line.

## 4. Write the doc first: concepts and diagrams

1. Create `docs/stages/NN-slug.md` from `docs/stages/_TEMPLATE.md`.
2. Before writing any code, fill in these sections:
   - **Goal**
   - **The real hardware**
   - **Key concepts**
   - **Diagrams** (at least one mermaid diagram)
   - **Our design**
3. This is the teaching core, so make it thorough:
   - Use real byte values in `&` hex.
   - Explain the why.
   - Cite datasheet or Advanced User Guide sections.
4. Check your facts against the datasheets and docs you know. If you're unsure of a hardware detail, say so in the doc rather than guessing confidently.

## 5. Test first, then implement

1. Write Jest tests next to the code (`*.test.ts`), named after hardware behaviour.
2. Implement the smallest thing that satisfies the stage. **Don't build ahead of the stage.** If you need a stub for a later stage, add it, name it clearly, and note it in the doc.
3. Follow the `CLAUDE.md` rules:
   - No `any`.
   - No `!`.
   - Mask bytes and words.
   - The core stays DOM-free.
   - No allocation in the hot path.
   - Name constants after the datasheet.
4. Never copy code from other emulators.

## 6. Build the observable outcome

1. Build exactly what the stage's **See it** line describes: a `scripts/demo-*.ts` plus an `npm run demo:*` entry, a workbench panel, or a screen change.
2. Run it yourself and capture the output.
3. For browser outcomes:
   - Start `npm run dev` in the background.
   - Use the Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_press_key`, …) to confirm it works.
4. Add a durable `e2e/*.spec.ts` check if the stage lists one.

## 7. Verify

Run the following and fix anything that fails:
```bash
npm test && npm run typecheck && npm run lint
```
(`lint` exists from Stage 00 onwards.) Report failures honestly. Don't hand over a stage with red checks.

## 8. Finish the doc

Complete the remaining template sections:
- **What you can now see**, with exact reproduction commands and the expected output.
- **Code walkthrough**, with file links.
- **Tests** table.
- **Gotchas & hardware quirks**.
- **Playwright verification**.
- **Check your understanding**: 3–5 questions, with answers in a `<details>` block.
- **Further reading**.

## 9. Hand over for review

1. In `PROGRESS.md`:
   - Set the status to `in review`.
   - Tick **Seen?** (✅) if you demonstrated the outcome.
   - Add any notes, and put open questions in the parking lot.
2. Do **not** commit unless the user asks.
3. Reply to the user with:
   - What was built, in 3–6 bullets.
   - **How to see it yourself**: the exact command or the browser steps.
   - Test, typecheck and lint results.
   - A link to the stage doc.
   - The "check your understanding" questions (without the answers).
   - A suggestion to run `/finish-stage` once they're happy.
