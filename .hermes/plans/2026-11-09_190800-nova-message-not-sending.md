# Fix: "sometimes when I send a message, it just doesn't send"

## Product decisions (from the owner)

- The **parked peak-hours queue notice stays up** (a queued turn is genuinely
  waiting; the composer's "Stop" state is correct). We do **not** auto-expire it.
  The only change for that case is making a swallowed *second* message
  non-silent (the toast in Task 1).
- The report is specifically about **the main composer**, not the follow-up
  suggestion chips (those call `sendMessage` directly and bypass the busy gate,
  so they are unaffected). Confirmed with the owner.

## Goal

In the nova-cloud-computer main composer, make a user's typed message never get
**silently swallowed**: when the composer is in its "busy → Stop" mode, a real
send attempt keeps the text in the box and explains what happened. The one
remaining *genuinely* stuck-gate input — an orphaned run row — is a deferred
server follow-up (Task 2).

## Current context / assumptions

Repo: `~/nova-cloud-computer` (pnpm 10.4.1, Node 24; pnpm only). Working on
`main`; `pnpm install` is current. This is a **client behavior change**, so per
repo `AGENTS.md`:
- Ship as a **branch + PR against `main`** (not a direct push).
- **No attribution lines** in commit/PR (no `Co-Authored-By`, no "Generated
  with"); match `git log` style (short imperative line, optional body).
- Quality gate: `pnpm run check` (`check:spa-cache` + `tsc --noEmit`).
- Tests: `pnpm test` = `vitest run` over the **whole suite** (glob includes
  `client/src/**/*.test.ts(x)`), so a new test file is picked up automatically —
  there is **no** curated test list to register here.
- CI also builds + runs a production smoke test; deploy to Vercel only.

### Where the bug lives (verified)

Send path: `client/src/hooks/useWorkspaceChat.ts` → `submit` (≈ lines 595–623),
wired to the composer form/button in `client/src/pages/Workspace.tsx` (the
button morphs to a **Stop** button when busy, lines 948–969).

```ts
// useWorkspaceChat.ts (current)
const agentIsWorking = isStreaming || Boolean(runStatus.data?.active);      // L282
const composerBusy = agentIsWorking || Boolean(queueNotice);                // L290

const submit = async (event) => {
  event.preventDefault();
  if (composerBusy) { handleStopRun(); return; }          // <-- the silent path
  if ((!draft.trim() && !composerAttachments.length) || !chatId) return;
  ...
  setDraft(""); setComposerAttachments([]);
  await sendMessage(chatId, content, images, files);
};
```

**Root cause of the symptom.** When `composerBusy` is true, Enter / the button
route to `handleStopRun()` instead of sending. `handleStopRun` (≈ L314) is a
silent no-op when `!chatId || stopRun.isPending`. So:
- The user types a real message and presses Enter → nothing is sent, no toast,
  the text just sits in the box. **"It just doesn't send."**
- `composerBusy` is true whenever any input is "busy": `isStreaming`, a
  `runStatus` poll reporting a live `agent_runs` row
  (`server/db/agentRuns.ts` `getActiveAgentRunInChat` — includes right after a
  turn settles, and when a row is orphaned by a killed serverless invocation),
  or a parked `queueNotice` (a peak-hours deferred turn that is waiting —
  *intended* to keep the composer busy).

Note: genuine *network* failures already surface a `toast.error` in
`sendMessage`'s catch (≈ L515–519), so they are **not** the silent case. The
silent case is exclusively the busy-gate routing above.

**Non-issues (confirmed):**
- `isStreaming` does not get stuck on the abort path — every abort is paired
  with a state reset (`[chatId]` effect, unmount, or a superseding send). No work.
- `queueNotice` staying up is *intended* (a queued turn), not a bug.

## Architecture / proposed approach

Keep the *intended* UX ("while Nova works, Enter stops the run") but stop the
failure from being **silent or destructive**. Move the submit *decision*
(stop vs. send vs. noop, plus the exact wire payload) into a small pure,
unit-testable helper `decideComposerSubmit` — matching this repo's pattern of
extracting pure helpers and testing them in the node environment (no DOM /
`@testing-library` is available). When the decision is "stop" but the user had a
non-empty draft, preserve the draft and show a throttled, neutral
`toast.message` explaining why it wasn't sent. The single *genuinely* stuck
input (an orphaned run row) is handled by a scoped server follow-up (Task 2).
TDD throughout: each helper is a pure function —
write-failing-test → red → implement → green → commit.

---

## Step-by-step tasks

> Run from `~/nova-cloud-computer`. Target one file per test so the red/green
> loop is fast; run the full suite at the end.

### Task 0 — Baseline (verify clean start)

1. `cd ~/nova-cloud-computer && git status` → clean tree.
   `git checkout -b fix/composer-doesnt-send-quietly`
2. `pnpm run check` → expected: `check:spa-cache` passes, `tsc --noEmit` clean.
3. `pnpm test client/src/pages/Workspace.kickoff.test.ts` → expected: `3 passed`
   (confirms the client test env runs green).

No commit yet; Task 1 produces the first commit.

### Task 1 — Pure submit decision + never-lose-draft + explanatory toast

**Files:** new `client/src/lib/composerSubmit.ts`; edit
`client/src/hooks/useWorkspaceChat.ts`.

#### 1a. Write the failing test (RED)

Create `client/src/lib/composerSubmit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideComposerSubmit } from "./composerSubmit";

describe("decideComposerSubmit", () => {
  it("stops the run when the composer is busy, even with a draft", () => {
    expect(
      decideComposerSubmit({ busy: true, draft: "hi", attachments: [], chatId: "c1" })
    ).toEqual({ kind: "stop" });
  });

  it("no-ops when there is no chat, or nothing to post", () => {
    expect(decideComposerSubmit({ busy: false, draft: "hi", attachments: [], chatId: undefined }))
      .toEqual({ kind: "noop" });
    expect(decideComposerSubmit({ busy: false, draft: "   ", attachments: [], chatId: "c1" }))
      .toEqual({ kind: "noop" });
  });

  it("sends plain text with the trimmed content and no attachments", () => {
    expect(
      decideComposerSubmit({ busy: false, draft: "  hello  ", attachments: [], chatId: "c1" })
    ).toEqual({ kind: "send", content: "hello", images: [], files: [] });
  });

  it("posts a single image attachment as its own caption and payload", () => {
    const img = { kind: "image" as const, id: "a", name: "corgi.png", mimeType: "image/png", dataUri: "data:image/png;base64,x" };
    expect(decideComposerSubmit({ busy: false, draft: "", attachments: [img], chatId: "c1" }))
      .toEqual({
        kind: "send",
        content: "Uploaded corgi.png",
        images: ["data:image/png;base64,x"],
        files: [],
      });
  });

  it("posts a single file attachment as its own caption and payload", () => {
    const f = { kind: "file" as const, id: "b", name: "notes.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,x", sizeBytes: 10 };
    expect(decideComposerSubmit({ busy: false, draft: "", attachments: [f], chatId: "c1" }))
      .toEqual({
        kind: "send",
        content: "Uploaded notes.txt",
        images: [],
        files: [{ name: "notes.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,x" }],
      });
  });

  it("posts multiple attachments with a count caption and mixed payloads", () => {
    const img = { kind: "image" as const, id: "a", name: "a.png", mimeType: "image/png", dataUri: "data:image/png;base64,i" };
    const file = { kind: "file" as const, id: "b", name: "b.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,f", sizeBytes: 10 };
    expect(decideComposerSubmit({ busy: false, draft: "look", attachments: [img, file], chatId: "c1" }))
      .toEqual({
        kind: "send",
        content: "look",
        images: ["data:image/png;base64,i"],
        files: [{ name: "b.txt", mimeType: "text/plain", dataUri: "data:text/plain;base64,f" }],
      });
  });
});
```

Run: `pnpm test client/src/lib/composerSubmit.test.ts`
Expected: **FAIL** — `Failed to resolve import "./composerSubmit"` (module not
created yet). That is the RED.

#### 1b. Implement the helper (GREEN)

Create `client/src/lib/composerSubmit.ts`:

```ts
import type { ChatComposerAttachment, ChatFileUpload } from "@/lib/fileAttachments";

/** What a composer submit (Enter or the send button) should do *right now*. */
export type ComposerSubmitDecision =
  | { kind: "stop" }
  | { kind: "send"; content: string; images: string[]; files: ChatFileUpload[] }
  | { kind: "noop" };

/**
 * Decide a submit before touching any state: "stop" while a run is in flight
 * (the composer button is the Stop affordance), "send" carrying the exact wire
 * payload when there is content to post, "noop" when there is nothing to do.
 * Pure, so it is testable without a DOM.
 */
export function decideComposerSubmit(input: {
  busy: boolean;
  draft: string;
  attachments: ChatComposerAttachment[];
  chatId: string | undefined;
}): ComposerSubmitDecision {
  if (input.busy) return { kind: "stop" };
  if (!input.chatId) return { kind: "noop" };
  const trimmed = input.draft.trim();
  if (!trimmed && !input.attachments.length) return { kind: "noop" };
  const images = input.attachments.flatMap(attachment =>
    attachment.kind === "image" ? [attachment.dataUri] : []
  );
  const files = input.attachments.flatMap(
    (attachment): ChatFileUpload[] =>
      attachment.kind === "file"
        ? [{ name: attachment.name, mimeType: attachment.mimeType, dataUri: attachment.dataUri }]
        : []
  );
  const content =
    trimmed ||
    (input.attachments.length === 1
      ? `Uploaded ${input.attachments[0].name}`
      : `Uploaded ${input.attachments.length} attachments`);
  return { kind: "send", content, images, files };
}
```

Run: `pnpm test client/src/lib/composerSubmit.test.ts` → **ALL PASS** (6 passed).

#### 1c. Wire the helper into `submit` + add the throttled toast

Edit `client/src/hooks/useWorkspaceChat.ts`:

1. Add to imports (top, with the other `@/lib/*` imports):
   ```ts
   import { decideComposerSubmit } from "@/lib/composerSubmit";
   ```
2. Add a module-level constant near the top (below the other consts, ~line 40):
   ```ts
   /** How often a "still working, so not sent" notice may repeat per user. */
   const BLOCKED_SEND_NOTICE_COOLDOWN_MS = 5_000;
   ```
3. Add a ref next to the other `useRef`s (near line 108):
   ```ts
   const lastBlockedSendNoticeAtRef = useRef(0);
   ```
4. **Delete** the now-unused `contentFor` helper (lines 236–240). It is used only
   by `submit`, and that logic now lives in `decideComposerSubmit`.
5. Replace the body of `submit` (lines 595–623) with:
   ```ts
   const submit = async (event: FormEvent | React.KeyboardEvent) => {
     event.preventDefault();
     const decision = decideComposerSubmit({
       busy: composerBusy,
       draft,
       attachments: composerAttachments,
       chatId,
     });
     if (decision.kind === "stop") {
       handleStopRun();
       // Never swallow a typed message silently: if the reader clearly meant to
       // send (non-empty draft, no attachment riding along), say so — throttled
       // so hammering Enter doesn't spam. The draft is kept (we return before
       // clearing it), so nothing the user wrote is lost.
       if (draft.trim() && !composerAttachments.length) {
         const now = Date.now();
         if (now - lastBlockedSendNoticeAtRef.current >= BLOCKED_SEND_NOTICE_COOLDOWN_MS) {
           lastBlockedSendNoticeAtRef.current = now;
           toast.message(
             "Nova is still working, so that message wasn't sent. Your text is kept in the box — press Stop when it's done, then send."
           );
         }
       }
       return;
     }
     if (decision.kind === "noop") return;
     setDraft("");
     setComposerAttachments([]);
     await sendMessage(chatId!, decision.content, decision.images, decision.files);
   };
   ```
   (`chatId!` is safe: `decideComposerSubmit` returns `"send"` only when
   `chatId` is defined; the `!` just satisfies the compiler.)

Run: `pnpm run check` → `check:spa-cache` OK, `tsc --noEmit` 0 errors. (If
deleting `contentFor` orphaned an import, confirm `ChatFileUpload` in this file
is still used by `sendMessage`'s signature — keep it.)
Run: `pnpm test client/src/lib/composerSubmit.test.ts client/src/pages/Workspace.kickoff.test.ts`
→ green.

Commit: `fix: don't silently swallow a typed send while Nova is working`

### Task 2 (follow-up, separate PR) — Root cause: stop reporting an orphaned run as active

This is the one *genuinely* stuck-gate input: a `chats.runStatus` poll that
reports a live `agent_runs` row still in `running`/`awaiting_continue` even
though the work is dead (a killed serverless invocation whose ledger row the
reaper in `server/runningProcesses.ts` will resume or dead-letter within a few
minutes). While that row is open, the composer stays in "Stop" mode and a normal
send is blocked. Fix it in a **second PR after Task 1 is merged**, because it
touches the server poll path and must not regress the legitimate "a run started
on Telegram / another tab keeps this composer busy" behavior.

Pick one:
- **A (preferred).** In `server/routers.ts` `chats.runStatus` (line ~761), when
  a run row is found, cross-check the durable process heartbeat
  (`listStaleRunningProcesses`, `server/runningProcesses.ts` L50
  `PROCESS_STALE_AFTER_MS` = 60s). If the run's `running_processes` row has no
  recent heartbeat *and* the reaper has exhausted its resume attempts, report
  `{ active: false }` so the composer unblocks.
- **B.** A bounded client grace period: treat `runStatus.data?.active` as
  non-blocking when the cached poll is older than ~2 poll intervals and
  `!isStreaming` — but only for the *originating* tab; runs started elsewhere
  keep blocking. (More fiddly.)

Do **not** bound on `agent_runs.updatedAt` — that column is not heartbeated
(only set at start/hold/claim/finish), so it would wrongly unblock a
genuinely-running single-segment run. Use the process heartbeat.

---

## Tests / validation

Automated (gate for the Task 1 PR — all must pass before merge):
- `pnpm test client/src/lib/composerSubmit.test.ts` → all `decideComposerSubmit`
  cases green (the RED→GREEN in Task 1).
- `pnpm test` (full suite) → green, no regressions.
- `pnpm run check` → `check:spa-cache` + `tsc --noEmit` clean.
- `pnpm run build` → SPA + server bundle build.

Manual repro (run `pnpm dev`, port 3000; `curl -fsS http://localhost:3000/api/health`
should answer first):
1. **Silent-swallow case (Task 1):** open a chat, type a message, and while Nova
   is mid-turn (or right after, inside the stale-active window) press Enter.
   **Before fix:** nothing happens, no feedback, text sits there (or is lost
   with no signal). **After fix:** a `toast.message` appears ("Nova is still
   working, so that message wasn't sent…") and the text is still in the box.
2. **Parked-queue case (intended behavior, per the owner):** during peak hours
   with a queued turn, the queue notice **stays up** and the composer stays in
   Stop mode — that is correct; do not add an auto-expiry. If the user types a
   *second* message and hits Enter, they now get the Task 1 toast instead of a
   silent swallow.
3. **Happy-path regression:** idle composer + typed message → Enter sends, reply
   streams, composer returns to Send, no toast.

## Risks, tradeoffs, and open questions

- **Enter-while-busy now toasts** (previously silent). Intentional — that is
  the fix — and it's throttled to one notice / 5s. The Stop action itself is
  unchanged (`handleStopRun` still runs first).
- **`contentFor` deletion:** it was used only by `submit`. If a reviewer prefers
  minimal diff, keep `contentFor` and still route through
  `decideComposerSubmit` — but that duplicates the 3-line derivation, so the
  plan removes it (DRY). Flag in the PR if keeping it.
- **Queue notice stays up by design** (owner decision) — the "stuck" queue case
  is not a bug; Task 1's toast is the only change there. A *queued* original
  message was accepted server-side, so the user's *second* message is what gets
  the toast.
- **Task 2 (orphaned run row) is the deeper root cause but is deferred** to a
  second PR to avoid regressing cross-tab/Telegram "still busy." Decide whether
  to schedule that follow-up now.
- **No attribution lines** in commits/PR. PR body: symptom, root cause
  (busy-gate silent swallow), and that Task 2 is a follow-up.
