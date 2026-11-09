# Plan — Remove the chat "working / typing / thinking" spinner animation (nova-cloud-computer)

## Goal
Remove every animated "working / typing / thinking" spinner from the workspace chat so nothing in the chat animates as a spinner, while keeping the running / completed / failed distinction legible through a **static** marker and the existing text labels.

## Current context / assumptions
- Repo: `~/nova-cloud-computer` (pnpm 10.4.1, Node 24, pnpm-only). React 19 SPA + Express/tRPC server.
- The "animation" the user pointed at (a screenshot: a spinning **dashed-circle** indicator shown while "Nova is working / typing") is the spinning `CircleDashed` from lucide. In the code it exists in exactly two families:
  1. **Standalone `TypingIndicator`** — the "Nova is working / Opening the thread…" spinner.
  2. **Live tool-activity "working / thinking" chips** in `toolActivityLine.tsx`: the amber `LiveNote` pill, the "latest line" spinner, and the running-state markers on `ToolActivityLine`, `ThinkingToolActivity`, `ToolRunGroup`, and `LiveActivityCard`.
- User decision for this task: **"Delete the indicator entirely — no 'working / typing / thinking' spinner at all in chat."**
- Interpretation the plan implements: **nothing in the chat may *spin*.**
  - A *pure* "working" pill whose only visual is the motion (the `LiveNote` icon, the "latest line" icon, the standalone `TypingIndicator`) **loses the icon**; its text label stays.
  - A *status* icon that also distinguishes running vs settled (the per-step / group / card running markers) is kept but made **static** (drop `animate-spin`), so "in progress" ≠ "completed" ≠ "failed" still reads.
- **Out of scope (do NOT touch):**
  - The Skills-page "library loading" spinner — `client/src/pages/Skills.render.test.tsx:104` (`expect(markup).toContain("animate-spin")`). It is a genuine data-load spinner, not a chat "working" indicator.
  - The landing Hero's three-dot `typing-dot` bounce (`index.css` `.typing-dot` / `nova-typing-bounce`).
  - The `.stream-caret` blinking caret on streaming text.
  - Any server-side run-state logic. This change is **presentational only** — it does not fix or affect the earlier "sometimes a message doesn't send" (orphaned-run) issue; it just removes the *animation*.

## Architecture / proposed approach
Three small, test-first, reversible edits: (1) delete the standalone `TypingIndicator` component and its two usages in `Workspace.tsx`, keeping the "Opening the thread…" and "Nova" text cues; (2) strip `animate-spin` from the six `CircleDashed` markers in `toolActivityLine.tsx` (deleting the icon where text already carries the state, keeping a static amber glyph where state must stay distinguishable); (3) update the two test files to assert the new, non-spinning behavior. No CSS or server changes are required. Then run `check` / `test` / `build`, open a PR, and squash-merge on green.

## Scope — exact elements to change

| # | File | Line (approx.) | What it is | Action |
|---|------|----------------|------------|--------|
| 1 | `client/src/components/workspaceChat.tsx` | 446–458 | `TypingIndicator()` (the standalone dashed spinner) | **Delete** the function |
| 2 | `client/src/components/workspaceChat.tsx` | 22 | `CircleDashed` in the lucide import | **Delete** the import line (only used by #1) |
| 3 | `client/src/pages/Workspace.tsx` | 66 | `TypingIndicator` in the workspaceChat import | **Delete** the import line |
| 4 | `client/src/pages/Workspace.tsx` | 545–549 | "Opening the thread…" placeholder | **Remove** `<TypingIndicator />`, keep `<span>Opening the thread…</span>` |
| 5 | `client/src/pages/Workspace.tsx` | 776–797 | `showTyping` "Nova is working" block | **Remove** the `animate-pulse` dot and the `<TypingIndicator />` card; keep the avatar + optional static "Nova" label |
| 6 | `client/src/pages/Workspace.tsx` | 1130 | `export { TypingIndicator }` | **Delete** |
| 7 | `client/src/lib/toolActivityLine.tsx` | 52–58 | `LiveNote` amber pill | **Remove** the `<CircleDashed …/>` icon, keep the `<p>{children}</p>` text |
| 8 | `client/src/lib/toolActivityLine.tsx` | 345–347 | "latest line" spinner | **Remove** the `{latest ? <CircleDashed/> : null}` block |
| 9 | `client/src/lib/toolActivityLine.tsx` | 612 | `ToolActivityLine` running marker | **Drop `animate-spin`** (static amber `CircleDashed`) |
| 10 | `client/src/lib/toolActivityLine.tsx` | 683 | `ThinkingToolActivity` running marker | **Drop `animate-spin`** |
| 11 | `client/src/lib/toolActivityLine.tsx` | 1272 | `ToolRunGroup` running header | **Drop `animate-spin`** |
| 12 | `client/src/lib/toolActivityLine.tsx` | 1351 | `LiveActivityCard` "Working now" marker | **Drop `animate-spin`** |
| 13 | `client/src/pages/Workspace.render.test.tsx` | 4, 756–779 | `TypingIndicator` import + tests | update import; delete one test; flip one assertion |
| 14 | `client/src/lib/toolActivityLine.test.tsx` | 722–735 | "marks failed tools and spins running ones" | rename; assert `not.toContain("animate-spin")` |

> Note: `CircleDashed` in `toolActivityLine.tsx` **stays imported** — it is still used (statically) at #9, #10, #11, #12. Only `workspaceChat.tsx` drops it (#2).

## Step-by-step tasks

### Task 0 — setup (2 min)
Work from a clean `main`:
```bash
cd ~/nova-cloud-computer
git checkout main && git pull --ff-only
git status            # clean (untracked .hermes/ is expected; leave it alone)
pnpm install --frozen-lockfile
```
Expected: deps installed; `main` up to date.

### Task 1 — delete the standalone `TypingIndicator` (TDD, ~6 min)

**1a. Write the failing test changes first.**

In `client/src/pages/Workspace.render.test.tsx`:

- Line 4 — change the import:
```ts
// old
import Workspace, { TypingIndicator } from "./Workspace";
// new
import Workspace from "./Workspace";
```
- Delete the entire test `it("renders an explicit animated status for the working state", ...)` (lines ~773–779) — it renders `<TypingIndicator />`, which no longer exists.
- In the test `it("shows active work from the backend run ledger after a refresh", ...)` (lines ~756–771), flip the `typing-indicator` assertion:
```ts
// old (line ~770)
expect(markup).toContain('data-testid="typing-indicator"');
// new
expect(markup).not.toContain('data-testid="typing-indicator"');
```

Run to confirm RED:
```bash
pnpm exec vitest run client/src/pages/Workspace.render.test.tsx
```
Expected: the flipped `not.toContain('data-testid="typing-indicator"')` **fails** (the app still renders the spinner). Other tests in the file pass.

**1b. Implement the removal.**

`client/src/components/workspaceChat.tsx`:
- Delete the function (lines 446–458):
```tsx
// REMOVE THIS
export function TypingIndicator() {
  return (
    <span
      data-testid="typing-indicator"
      role="status"
      aria-live="polite"
      aria-label="Working"
      className="inline-flex items-center text-muted-foreground"
    >
      <CircleDashed className="size-4 animate-spin" />
    </span>
  );
}
```
- Delete `  CircleDashed,` from the lucide-react import (line 22).

`client/src/pages/Workspace.tsx`:
- Line 66 — delete `  TypingIndicator,` from the `@/components/workspaceChat` import.
- Lines 545–549 — remove the `<TypingIndicator />` line, keep the text; drop the now-redundant `gap-2`:
```tsx
// old
<div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
  <TypingIndicator />
  <span>Opening the thread…</span>
</div>
// new
<div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
  <span>Opening the thread…</span>
</div>
```
- Lines 776–797 — in the `showTyping` block, delete the `animate-pulse` dot and the `TypingIndicator` card; keep the avatar + optional static "Nova" label:
```tsx
// old (the inner divs of the showTyping block)
<div className="mb-2 flex items-center gap-2">
  {typingLabel && (
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
      Nova
    </p>
  )}
  {typingLabel && (
    <span className="size-1 animate-pulse rounded-full bg-primary" />
  )}
</div>
<div className="border-s border-primary/40 bg-card/65 px-4 py-3.5 shadow-sm dark:bg-white/[0.045]">
  <TypingIndicator />
</div>
// new
<div className="mb-2 flex items-center gap-2">
  {typingLabel && (
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
      Nova
    </p>
  )}
</div>
```
(The outer `<span>` holding `<NovaLogo size={12} />` and the `min-w-0` wrapper stay untouched.)
- Line 1130 — delete `export { TypingIndicator };`.

Run to confirm GREEN + typecheck:
```bash
pnpm exec vitest run client/src/pages/Workspace.render.test.tsx
pnpm run check
```
Expected: that test file passes; `check` (spa-cache + `tsc --noEmit`) is clean (this catches the now-unused `CircleDashed` / `TypingIndicator` imports you just removed).

Commit:
```bash
git add -A client/src
git commit -m "chat: remove the standalone typing indicator"
```

### Task 2 — de-spin the tool-activity "working / thinking" markers (TDD, ~6 min)

**2a. Write the failing test change first.**

In `client/src/lib/toolActivityLine.test.tsx` (the test at lines ~722–735):
```ts
// old
it("marks failed tools and spins running ones", () => {
  ...
  expect(running).toContain("animate-spin");
});
// new
it("marks failed tools and flags running ones", () => {
  ...
  expect(running).not.toContain("animate-spin");
  expect(running).toContain("text-amber-600"); // the static amber running marker stays
});
```
(Keep the surrounding `failed` / `running` render calls unchanged; only rename the `it` title and change the last expectation.)

Run to confirm RED:
```bash
pnpm exec vitest run client/src/lib/toolActivityLine.test.tsx
```
Expected: the `not.toContain("animate-spin")` expectation **fails** (a running `ToolActivityLine` still spins).

**2b. Implement the six edits in `client/src/lib/toolActivityLine.tsx`.**

(a) `LiveNote` (~52–58) — drop the icon, keep the text pill (leave the `<p>` className as-is; only delete the icon line):
```tsx
// old
<p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
  <CircleDashed className="size-3.5 shrink-0 animate-spin" />
  {children}
</p>
// new
<p className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400">
  {children}
</p>
```

(b) "latest line" spinner (~345–347) — delete this block:
```tsx
// REMOVE THESE LINES
{latest ? (
  <CircleDashed className="size-3.5 shrink-0 animate-spin" />
) : null}
```
(the surrounding `<p>` and `<span>{line}</span>` stay).

(c) `ToolActivityLine` running marker (~612):
```tsx
// old
className={`size-3.5 shrink-0 ${stateClass}${activity.state === "running" ? " animate-spin" : ""}`}
// new
className={`size-3.5 shrink-0 ${stateClass}`}
```

(d) `ThinkingToolActivity` running marker (~683):
```tsx
// old
<CircleDashed className="size-3 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
// new
<CircleDashed className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
```

(e) `ToolRunGroup` running header (~1272):
```ts
// old
? "text-amber-600 dark:text-amber-400 animate-spin"
// new
? "text-amber-600 dark:text-amber-400"
```

(f) `LiveActivityCard` "Working now" marker (~1351):
```tsx
// old
<CircleDashed className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
// new
<CircleDashed className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
```

> Leave the `CircleDashed` import in this file — it is still used (statically) by (c), (d), (f).

Run to confirm GREEN + typecheck:
```bash
pnpm exec vitest run client/src/lib/toolActivityLine.test.tsx
pnpm run check
```
Expected: the updated test passes (running row has no `animate-spin`, keeps `text-amber-600`); `check` is clean.

Commit:
```bash
git add -A client/src
git commit -m "chat: de-spin the tool-activity running markers"
```

### Task 3 — full validation + sweep (5 min)

```bash
pnpm test            # whole suite: expect all pass (baseline ≈ 145 files / ~1578 tests, 4 pre-existing skips)
pnpm run check       # spa-cache + tsc: clean
pnpm run build       # production build: green (a pre-existing chunk-size warning is OK)
```
Confirm nothing chat-spinning remains, and the out-of-scope spinner is intact:
```bash
grep -rn "animate-spin" client/src/components/workspaceChat.tsx client/src/lib/toolActivityLine.tsx
# expected: NO matches (0 lines)
grep -n "animate-spin" client/src/pages/Skills.render.test.tsx
# expected: still present at line ~104 (do not touch)
```
i18n: no `t()` keys were removed (all text labels were kept), so the i18n test is unaffected. Reduced-motion: `index.css` still carries `@media (prefers-reduced-motion)` overrides for `.typing-dot`, `.stream-caret`, `.chat-in`; none of them govern the removed spin, so **no CSS change** is needed.

If any **other** test still asserts the removed spinner, update that assertion to the new (absent / static) behavior rather than reverting the component — then re-run `pnpm test`.

### Task 4 — branch, PR, merge

```bash
git switch -c remove/chat-working-spinner      # from main
git push -u origin remove/chat-working-spinner
```
Open the PR (repo template, no attribution lines — no `Co-Authored-By`, no "Generated with"):
```bash
gh pr create --title "chat: remove the working/typing/thinking spinner animation"
```
PR body — fill the repo template sections; a suitable draft:
```
## Summary
The workspace chat showed a spinning dashed-circle "Nova is working / typing /
thinking" indicator. Remove the animation so nothing in the chat spins, while
keeping running/completed/failed state legible via a static marker + text.

## Related issue
Requested by Marcus: "Find and remove this animation from the app" — the
three-dot / "Nova is working" chat indicator.

## Changes
- Delete the standalone `TypingIndicator` (workspaceChat.tsx) and its two usages
  in Workspace.tsx ("Opening the thread…" + the `showTyping` working block);
  the "Opening the thread…" and "Nova" text cues are kept.
- De-spin the six `CircleDashed` markers in toolActivityLine.tsx (LiveNote,
  latest-line, ToolActivityLine, ThinkingToolActivity, ToolRunGroup,
  LiveActivityCard): delete the icon where text carries state, otherwise make
  the marker static amber.
- Update the two affected test files to assert the non-spinning behavior.

## Testing
- `pnpm test` (whole suite) — green.
- `pnpm run check` (spa-cache + tsc) — clean.
- `pnpm run build` — green.
- `grep animate-spin` over workspaceChat.tsx / toolActivityLine.tsx returns no
  matches; the Skills-page load spinner is intentionally untouched.
```
Watch CI, then merge (standing preference: auto-merge on green):
```bash
gh pr checks <n> --watch          # wait for Quality checks + production smoke test (port 4176)
gh pr merge <n> --squash --delete-branch
git checkout main && git pull --ff-only   # local main now has the merged commit
```

## Tests / validation (TDD summary)
- Task 1: flip `Workspace.render.test.tsx` assertion + delete the `TypingIndicator` render test → RED → delete component/usages → GREEN → `pnpm run check` clean → commit.
- Task 2: update `toolActivityLine.test.tsx` "…spins running ones" → RED → apply 6 edits → GREEN → `pnpm run check` clean → commit.
- Task 3: full `pnpm test` + `pnpm run check` + `pnpm run build` + the two greps above.

## Risks, tradeoffs, and open questions
- **Loss of the "in progress" affordance.** A running tool now shows a *static* amber dashed ring instead of a spinning one; a settled `CheckCircle2`/`XCircle` still distinguishes outcomes. This is the user's explicit choice ("delete the indicator entirely — no spinner at all"). **Tradeoff:** a long-running tool no longer visually "moves" — acceptable, and arguably calmer.
- **`showTyping` block.** After the edit it renders a static Nova avatar + optional "Nova" label (when `typingLabel` is true; the label is gated on the first reply / after a user message). When `typingLabel` is false the inner wrapper is an empty div with an 8px top margin — a trivial cosmetic artifact, not a bug. **Alternative if the user wants *zero* "working" visual:** delete the entire `{showTyping && (...)}` block instead of keeping the static label.
- **Alternative if the user wants the amber marker *gone* (not just static):** also delete the `CircleDashed` at #9/#10/#11/#12 and let the text row carry state — but that reduces at-a-glance scannability of a 30-row tool run. Not recommended; not in the default plan.
- **Scope boundary.** The Skills-page library spinner and the Hero `typing-dot` / stream caret are deliberately out of scope. If the user actually meant *those*, this plan needs a follow-up (they are separate, intentional data-load / landing animations).
- **No server or data changes.** This is presentational client work; it neither fixes nor regresses the earlier "message sometimes doesn't send" (orphaned-run) issue.
