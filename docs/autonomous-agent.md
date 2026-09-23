# Autonomous mission worker

Nova's scheduled automations now use the same tool-capable runtime as interactive workspace conversations. Each automation keeps a durable mission chat and runs an observe → plan → act → verify → report loop.

## Research takeaways

- [Manus](https://manus.im/docs/introduction) emphasizes a persistent sandbox, internet access, filesystem state, and end-to-end execution rather than answer-only chat.
- [OpenClaw](https://docs.openclaw.ai/agent-runtime-architecture) separates an agent core from sessions, skills, tool policy, compaction, and multi-agent/runtime wiring. Its important property is durable runtime state with explicit lifecycle boundaries.
- [OpenCode](https://dev.opencode.ai/docs) makes project context explicit with AGENTS.md, supports plan-first work, tool permissions, and undo/redo so coding actions remain inspectable and recoverable.

## Nova implementation

- Scheduled user automations reuse a persistent chat as mission memory instead of starting from a blank LLM request every time.
- The worker calls executeWebAgentRun, so it can inspect and mutate workspace files, use the persistent E2B sandbox, use connected tools, verify mutations, and continue across serverless time limits.
- Runtime metadata is stored inside the existing automation definition JSON: chat ID, last status, last summary, and report artifact ID. No new migration is needed.
- Every run still saves a Markdown report, while the full tool/activity history remains available in the mission chat.
- Safety boundaries remain explicit: compiled constraints are passed into the mission prompt, unavailable capabilities cannot be invented, and unverified work must be reported as incomplete.
