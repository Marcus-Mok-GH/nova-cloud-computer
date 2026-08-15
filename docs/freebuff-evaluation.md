# Freebuff / Codebuff Evaluation for Nova

## Evidence gathered

Freebuff is the public coding-agent product built on Codebuff. Its repository describes a TypeScript/Bun monorepo containing agents, tools, a CLI, and an SDK. The repository directs application embedders to Codebuff documentation and `@codebuff/sdk`, rather than documenting Freebuff itself as a separately supported server framework.[1]

Codebuff’s SDK supports programmatic agent runs via `CodebuffClient` and `client.run()`. The documented run contract accepts an agent identifier, prompt, project-file map, custom agent and tool definitions, a step limit, an event callback, and prior conversation state. Its events include lifecycle, tool-call, tool-result, text, and error records, which could be translated into Nova’s run-history model.[2]

The official privacy documentation is a material constraint for Nova. It says Codebuff and Freebuff use prompts, messages, code, files, and repository data to provide the service, and that prompts and messages may be analyzed to personalize ads. It further says model or feature submissions may be retained for development, training, testing, evaluation, fine-tuning, and improvement when the relevant model or feature says data may be used for training.[3]

## Product distinction

| Option | What it is | Programmatic fit for Nova | Practical constraint |
| --- | --- | --- | --- |
| **Freebuff CLI** | A terminal coding-agent product that the vendor positions as free, no-key, and ad-funded. | Low. Its documented entry point is the interactive `freebuff` terminal command, not a server API. | It needs network access to the Freebuff service, so it conflicts with Nova’s default-deny Daytona egress posture.[4] |
| **Codebuff SDK** | The documented embeddable interface underlying Freebuff. | High. `CodebuffClient.run()` supports structured inputs, event callbacks, custom agents, custom tools, and a step cap. | It requires a Codebuff API key and sends the provided context to a hosted service.[2] |
| **Fork / self-host exploration** | The Freebuff repository is Apache-2.0 licensed. | Indeterminate. The license allows reuse, but the public repository itself does not establish a supported self-hosted model-service replacement. | Nova would own ongoing security, model-provider, and operational work.[5] |

## Nova / Daytona fit assessment

It is **technically possible**, but Freebuff should not be Nova’s default agent runtime. The safe architecture is to retain **Daytona as the execution boundary** and, only after a user explicitly chooses the provider for an individual run, invoke Codebuff’s SDK on the server with a deliberately selected workspace bundle. The SDK receives project files as an explicit map and offers custom-tool definitions, which makes a narrow adapter feasible.[2]

The adapter must not hand Codebuff direct Daytona credentials, raw user API keys, database access, or a general shell. Nova’s first release deliberately omits tools altogether: Codebuff receives only an explicitly selected, bounded file map and returns a structured **plan**, not commands or file mutations. Daytona remains separate and retains its blocked-egress execution posture.

> **Recommendation:** Adopt **Codebuff SDK as an optional, per-run “Freebuff-style coding” provider only after explicit informed consent. Do not invoke the Freebuff CLI as a background agent, and do not make either provider the default for private workspaces.

This boundary is necessary because the official policy says the service uses prompts, messages, code, files, and repository data to provide the service; prompts/messages may be analyzed for ad personalization, and some submissions may be retained for model or product improvement.[3] The vendor’s free CLI is explicitly supported by text ads and advertises no API key, while the documented SDK requires an API key, so the two consumption models should not be conflated.[2] [4]

## Guarded implementation path

The first integration is deliberately small and is now implemented. The **Codebuff planner** switch in Workspace defaults off. Before every run, the user selects up to twelve files and confirms that their contents will be sent to Codebuff. Nova stores a provider-labelled private run record and a Markdown planning artifact, while returning no private credential to the browser. The user enters their own API key only in authenticated Settings; Nova encrypts it at rest, decrypts it only within the server-side adapter, and never forwards it to Daytona, prompts, browser state, or agent tools. Each request is limited to six agent steps, 75 seconds, 24,000 characters per file, and 120,000 total bundle characters.[2]

## Codebuff key compatibility

**Yes.** A Codebuff API key is the documented credential for programmatic `@codebuff/sdk` use: it is supplied when constructing `CodebuffClient`, then used by `client.run()` to run the chosen agent.[2] This is the supported way for Nova to provide Freebuff-style agent behavior from its server.

The key is not required by the separate Freebuff CLI product, which advertises a free, no-key interactive terminal experience.[4] Therefore, a Codebuff key does not “unlock” Freebuff CLI; it enables the **Codebuff SDK integration** that Freebuff itself is built upon. In Nova, the user enters the key only through an authenticated Settings field. Nova AES-GCM encrypts it at rest, returns only connection metadata to the browser, decrypts it only in the server-side Codebuff adapter, and never copies it into a Daytona environment or an agent prompt.

## References

[1]: https://github.com/CodebuffAI/freebuff "CodebuffAI/freebuff repository"
[2]: https://www.codebuff.com/docs/advanced/sdk "Codebuff SDK & Programmatic Access"
[3]: https://www.codebuff.com/docs/advanced/privacy "Codebuff Privacy"
[4]: https://freebuff.com/cli "Freebuff CLI"
[5]: https://raw.githubusercontent.com/CodebuffAI/freebuff/main/LICENSE "Freebuff Apache License 2.0"
