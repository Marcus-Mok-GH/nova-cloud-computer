/**
 * The public skill catalogue: ready-made procedures anyone can search and add
 * to their own library from the Skills page.
 *
 * It lives in `shared/` beside the Agent Skills rules so the catalogue and the
 * form that saves it validate against the same spec - a skill shipped here is
 * one the create endpoint accepts as-is. The data is static, so search runs in
 * the browser: no query, no round trip, and the gallery still works when the
 * user's own library is still loading.
 *
 * Adding is a normal create: the copy lands in the caller's `workspace_skills`
 * row and is theirs from then on - editable, deletable, and never overwritten
 * when this catalogue changes.
 */
/** One catalogue entry, in the Agent Skills shape the create endpoint takes. */
export type PublicSkill = {
  name: string;
  description: string;
  body: string;
};

/**
 * Curated public skills, alphabetised by name so the list reads the same way
 * every release. Bodies are instructions Nova follows verbatim once added, so
 * each one states the steps rather than describing them.
 */
export const PUBLIC_SKILLS: readonly PublicSkill[] = [
  {
    name: "api-design",
    description:
      "Designs a REST API surface: resources, endpoints, status codes and error shape, with request and response examples. Use when the user asks to design, spec, or review an API.",
    body: `1. Name the resources first (nouns, plural, lowercase), then the actions on each one. Every endpoint should map to one resource or one explicit action.
2. For each endpoint give the method, path, request shape, success code, and the error codes it can return. Prefer 404 for a missing resource, 409 for a conflict, 422 for validation.
3. Show one concrete request and response pair per endpoint - a real-looking body beats a field table for getting feedback.
4. Keep errors uniform: one JSON shape (code, message, details) across every endpoint.
5. Call out what is deliberately NOT in the first version, and the pagination, idempotency and versioning decisions up front.`,
  },
  {
    name: "bug-triage",
    description:
      "Reproduces a reported bug, narrows it to the likely cause, and files it with severity, environment and steps to reproduce. Use when the user reports something broken.",
    body: `1. Restate the report as: what was expected, what happened, and on what (browser/device/version/accounts involved).
2. Reproduce it. If it cannot be reproduced, say so plainly and list what would be needed to (account state, seed data, a sample URL).
3. Narrow the cause: search the code for the path the report touches and name the first suspicious line or branch - a hypothesis with a file reference, not a guess.
4. Assign severity: blocker (data loss or a dead main path), high (core flow broken, no workaround), medium (workaround exists), low (cosmetic).
5. File it with: summary, steps to reproduce, expected vs actual, environment, severity, and the suspected area. Keep it in one message the user can copy.`,
  },
  {
    name: "code-review",
    description:
      "Reviews a code change for correctness, risk and clarity, then reports findings ordered by severity. Use when the user asks for a review, a PR review, or feedback on a diff.",
    body: `1. Read the change with its tests. Understand what the author intended before judging it.
2. Report in this order: blockers (bugs, data loss, security, broken contracts), then risks (missing tests, silent behaviour changes, perf), then nits (naming, structure).
3. Every finding names the file and line and says what breaks - "this can be null on the retry path" is a finding; "consider handling errors" is not.
4. Say what is good about the change too, briefly, so the signal stays trustworthy.
5. End with a verdict: approve, approve with changes, or request changes. Do not open new scope that the change does not need.`,
  },
  {
    name: "commit-messages",
    description:
      "Turns a set of changes into Conventional Commit messages, one per logical change. Use when the user asks to write commits, summarize a diff, or prepare a push.",
    body: `1. Run \`git diff --stat\` (and \`git log --oneline -10\` to match the repo's own style) before writing anything.
2. Group the diff into logical changes - one commit per thing that could be reverted on its own. Never bundle an unrelated fix with a feature.
3. Format: \`type(scope): summary\` in the imperative mood, under 72 characters, no trailing period. Use the types the repo already uses.
4. In the body, say why the change was needed, not what the diff already shows.
5. Return the commits in the order they should be applied, ready to paste - and do not run the commits unless the user asked.`,
  },
  {
    name: "csv-cleanup",
    description:
      "Cleans messy tabular data: fixes headers, types, dates, duplicates and missing values, then reports exactly what changed. Use when the user pastes or uploads spreadsheet or CSV data.",
    body: `1. Before changing anything, report the shape: rows, columns, and what looks wrong (mixed types, blank headers, stray whitespace, inconsistent casing, duplicate rows).
2. Normalise headers to lowercase kebab-case; keep a mapping of old to new so nothing is silently renamed.
3. Parse dates into one ISO format and numbers into one locale - never guess a column's meaning without saying what you assumed.
4. Deduplicate on the most specific key that still makes sense, and report how many rows went.
5. Output the cleaned file plus a change log: what was fixed, how many cells/rows, and what you deliberately left alone.`,
  },
  {
    name: "email-reply",
    description:
      "Drafts a reply to an email in the user's voice, matching the thread's tone and answering every question asked. Use when the user shares an email and asks how to respond.",
    body: `1. List every question or request in the incoming message first - a reply that misses one is worse than a slow one.
2. Match the sender's register: short and casual stays short and casual; formal stays formal. Mirror their greeting and sign-off.
3. Lead with the answer or the decision, then the detail. No throat-clearing ("I hope this email finds you well").
4. Put dates, times and commitments in the body explicitly so they can be quoted back.
5. Offer the draft, then one line noting anything the user must fill in (a time, a name, an attachment). Keep it under 150 words unless the content demands more.`,
  },
  {
    name: "incident-postmortem",
    description:
      "Writes a blameless postmortem from an incident: timeline, root cause, impact and action items with owners. Use when the user asks to write up an outage or failure.",
    body: `1. Establish the facts first: when it started, when it was detected, when it was resolved, and the measured impact (users affected, requests failed, duration).
2. Build the timeline from evidence - logs, deploys, alerts - not memory. One entry per step, timestamped, including the wrong turns.
3. Root cause: the single condition that made the failure possible, then the chain of contributing factors. Separate "what failed" from "why it was allowed to".
4. Impact section states what users saw, in their words, and what was NOT affected.
5. Action items each get an owner and a date, and must map back to a factor in the chain - an item that fixes nothing is not an action item.
6. Close with what went well (detection, mitigation), so the document is not only a list of faults.`,
  },
  {
    name: "meeting-notes",
    description:
      "Turns raw meeting notes into decisions, action items with owners, and open questions. Use when the user pastes notes or asks to clean up a meeting.",
    body: `1. Strip the transcript down to three buckets: decisions made, actions to take, questions still open. Drop small talk and restated context.
2. Every action gets an owner and a due date. If the notes do not say who, write "unassigned" rather than inventing one.
3. Decisions are written as statements ("we ship on the 14th"), not discussion summaries - a reader must know what was settled.
4. Keep the original wording where it matters; paraphrasing a decision changes it.
5. Output: decisions, actions (owner / due), open questions, then a one-line summary at the top for anyone who skipped the meeting.`,
  },
  {
    name: "release-notes",
    description:
      "Drafts user-facing release notes from merged PRs or a commit range, grouped by what the user will notice. Use when the user asks for a changelog, release notes, or what's new.",
    body: `1. Gather the range: \`git log --oneline <from>..<to>\` or the merged PRs since the last tag. Exclude merges, chores and dependency bumps unless they changed behaviour.
2. Group by what the reader experiences (New, Improved, Fixed), never by internal area.
3. Write each line for a user: what changed and why it matters to them. "Refactored the polling loop" becomes "Conversations update faster now".
4. Keep the repo's existing voice and heading style - read the previous entry first.
5. Anything that changes behaviour or needs a migration gets its own callout at the top, marked clearly.`,
  },
  {
    name: "research-brief",
    description:
      "Researches a topic and returns a cited brief: the answer first, then the evidence, then the open questions. Use when the user asks to research, compare, or investigate something.",
    body: `1. Restate the question as a single sentence, including any constraint the user implied (budget, timeframe, region, audience).
2. Lead with the answer or recommendation in three sentences or fewer. The reader should be able to stop there.
3. Then the evidence: each claim carries its source with a link, and competing sources are shown side by side rather than averaged.
4. Separate what is known from what is inferred. Mark inference explicitly.
5. Close with what would change the recommendation, and the two or three questions that remain open.
6. Never present a number you could not source - say "not found" instead.`,
  },
  {
    name: "slide-deck",
    description:
      "Outlines a presentation from a topic or a document: storyline, one message per slide, and speaker notes. Use when the user asks for slides or a deck.",
    body: `1. Establish the audience and the single thing they should believe or do when the room empties. Everything else serves that.
2. Build the storyline as a sequence of claims - each slide must advance the argument, not just add information. If a slide can be deleted without losing the point, delete it.
3. One message per slide, written as a full sentence headline (the claim), not a topic label. Supporting bullets prove that claim only.
4. Notes carry the spoken detail: what to say, what to skip if time runs short, and the likely question.
5. End with the ask - the decision, budget, or next step - on its own slide.
6. Output as an outline the user can paste into a deck tool, with a suggested visual for each slide.`,
  },
  {
    name: "sql-tuning",
    description:
      "Analyzes a slow SQL query and proposes indexes, rewrites and schema changes, each with the reasoning. Use when the user asks why a query is slow or how to speed it up.",
    body: `1. Get the actual query and, if available, the EXPLAIN (ANALYZE, BUFFERS) output. Without a plan, every suggestion is a guess - say so and ask for it.
2. Read the plan for the expensive node first: sequential scan on a large table, wrong join order, rows misestimated by orders of magnitude, sorts spilling to disk.
3. Propose changes in order of cost/benefit: a covering index or a better predicate first, then a rewrite (join order, early filtering, avoiding SELECT *), then schema changes.
4. For every index, say what query it serves, what it will slow down (writes, storage), and why the column order is what you chose.
5. Estimate the effect where the plan allows it, and give the verification step: the exact query to re-run and what to compare.`,
  },
  {
    name: "weekly-report",
    description:
      "Writes a weekly status report from the week's work: what shipped, what was decided, what is blocked, and next week's plan. Use when the user asks for a weekly update or Friday summary.",
    body: `1. Gather the week's evidence first - merged PRs, closed issues, deploy notes, decisions in chat - and work only from that, not from memory.
2. Write four short sections: Shipped (with the one-line user benefit each), Decisions, Blocked/At risk, Next week (three items, ordered by what unblocks others).
3. Keep every line verifiable: a reader should be able to click through to the thing described.
4. Put the headline first - one sentence on how the week went - so the report can be skimmed in ten seconds.
5. No self-assessment filler ("a productive week"). Facts and dates only. Match the length and tone of the previous report if one exists.`,
  },
];

/** The catalogue sorted by name - what the page shows before any search. */
export function listPublicSkills(): PublicSkill[] {
  return [...PUBLIC_SKILLS].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Case-insensitive search across the catalogue, matching the name, the
 * description and the instructions, so "deploy" finds a skill whose steps
 * mention deploying even when the description does not. An empty query returns
 * the whole catalogue.
 */
export function searchPublicSkills(
  query: string,
  skills: readonly PublicSkill[] = PUBLIC_SKILLS
): PublicSkill[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...skills];
  return skills.filter(skill =>
    `${skill.name}\n${skill.description}\n${skill.body}`
      .toLowerCase()
      .includes(needle)
  );
}
