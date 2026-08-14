# Zo Computer Research Notes — August 2026

## What Zo Computer is

Zo positions itself as a **Personal Cloud**: an always-available cloud computer that brings a user’s files, data, tools, and AI together in a space they control. Its product model combines persistent compute and storage with an agent that can work through chat, automation, messaging channels, and a browser/terminal environment.[1][2]

| Product capability | Evidence from Zo’s official materials | Implication for Nova |
| --- | --- | --- |
| **Persistent workspace** | Zo sells always-on availability, storage, memory across sessions, hosted services, and custom domains rather than a conventional task-only app.[2] | Nova should lead with a durable personal cloud workspace, not only projects and tasks. |
| **Agent-driven work** | Zo’s agent can use built-in web, file, media, research, messaging, and development tools.[3] | Nova should make its assistance layer visible as an operational guide, with clear scope and approval boundaries. |
| **Conversation and memory** | Chats are saved, searchable, and persist across devices; rules preserve user preferences across conversations.[4][5] | Nova should retain workspace preferences/rules as first-class persistent data. |
| **Scheduled automations** | Zo automations run prompts on schedules using the same files, tools, and integrations as chat, with a run history and configurable delivery.[6][7] | Nova should add an automation model with schedule, state, delivery preference, and run history; a scheduler must follow the project’s periodic-update architecture. |
| **Build and hosting** | Zo provides direct hosting, services, terminal access, and custom domains inside the personal cloud.[2][6] | Nova should describe its current product honestly as the organised “home layer,” while reserving hosting and tool execution for a later server-agent release. |

## Research-informed Nova changes

Nova will retain its original visual identity, but its product proposition should become: **a personal cloud workspace where projects, preferences, and working context stay organised and available.** The current task manager becomes one capability of a broader workspace.

The immediate functional changes are persistent workspace rules, model preference, private custom endpoint records, and revised landing-page messaging that foregrounds durable context and user control. Scheduled automations were deliberately deferred in favour of the selected workspace-first scope.

## Verification boundary

The public landing page and authenticated settings screen were reviewed in the running application. The custom-model API, encrypted-at-rest credential handling, data isolation, and real-database persistence paths passed automated verification. The optional live signed-in browser interaction for submitting and removing a model was explicitly deferred at the user’s request.

## Sources

[1] [Zo Computer homepage](https://www.zo.computer/)

[2] [Zo Computer pricing](https://www.zo.computer/pricing)

[3] [Zo Computer tools](https://www.zo.computer/tools)

[4] [Zo chats](https://www.zo.computer/app/chats)

[5] [Zo rules](https://www.zo.computer/app/rules)

[6] [Zo automations product page](https://www.zo.computer/app/automations)

[7] [Zo automations documentation](https://zocomputer.mintlify.app/automations)
