/**
 * The set_env_var agent tool: stores a known value directly, and raises a
 * secure composer request when the value must come from the user. Whatever
 * the path, the value itself must never appear in the result the model reads
 * back, and the request path must never run where there is no secure input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolSetEnvVar } from "./workspaceTools/envvars";
import type { ToolCtx } from "./workspaceTools/types";

const db = vi.hoisted(() => ({
  setWorkspaceEnvVarForUser: vi.fn(),
  requestWorkspaceEnvVarForUser: vi.fn(),
  cancelPendingEnvVarRequestsForName: vi.fn(),
}));

vi.mock("./db/envVars", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db/envVars")>();
  return { ...actual, ...db };
});

/** A minimal per-call context; only the fields the family reads are set. */
const ctxFor = (overrides: Partial<ToolCtx> = {}) =>
  ({
    ownerId: 1,
    args: {},
    str: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
    chatId: "chat-1",
    channel: "web",
    ...overrides,
  }) as ToolCtx;

describe("set_env_var", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.setWorkspaceEnvVarForUser.mockResolvedValue({
      name: "STRIPE_API_KEY",
      value: "sk_test_123",
    });
    db.requestWorkspaceEnvVarForUser.mockResolvedValue({
      id: 7,
      chatId: "chat-1",
      name: "SENDGRID_API_KEY",
      reason: "sending mail",
      createdAt: new Date("2026-10-22T00:00:00Z"),
    });
    db.cancelPendingEnvVarRequestsForName.mockResolvedValue(undefined);
  });

  it("stores a known value directly and closes any pending request for it", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({
        args: {
          name: " stripe_api_key ",
          value: " sk_test_123 ",
          reason: "payments",
        },
      })
    );
    expect(db.setWorkspaceEnvVarForUser).toHaveBeenCalledWith(
      1,
      "STRIPE_API_KEY",
      "sk_test_123"
    );
    expect(db.cancelPendingEnvVarRequestsForName).toHaveBeenCalledWith(
      1,
      "STRIPE_API_KEY"
    );
    expect(db.requestWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(execution.ok).toBe(true);
    // The name is how the model references the variable; the value must not
    // leak into anything the model reads back.
    expect(execution.result).toContain("STRIPE_API_KEY");
    expect(execution.result).not.toContain("sk_test_123");
    expect(execution.action).toMatchObject({
      kind: "tool",
      name: "STRIPE_API_KEY",
      operation: "updated",
    });
  });

  it("raises a secure composer request when the value must come from the user", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({
        args: { name: "SENDGRID_API_KEY", reason: "sending mail" },
      })
    );
    expect(db.requestWorkspaceEnvVarForUser).toHaveBeenCalledWith(1, {
      chatId: "chat-1",
      name: "SENDGRID_API_KEY",
      reason: "sending mail",
    });
    expect(db.setWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(execution.ok).toBe(true);
    // The model is told a request is waiting and to end its turn - never
    // asked to collect the value in the chat.
    expect(execution.result).toContain("SENDGRID_API_KEY");
    expect(execution.result).toContain("end your turn");
    expect(execution.result).toContain("Do NOT ask them to paste");
  });

  it("treats an empty or whitespace value as a request, not a blank save", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({ args: { name: "ANTHROPIC_API_KEY", value: "   " } })
    );
    expect(db.setWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(db.requestWorkspaceEnvVarForUser).toHaveBeenCalledTimes(1);
    expect(execution.ok).toBe(true);
  });

  it("refuses the request path where there is no secure input (Telegram)", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({
        args: { name: "SENDGRID_API_KEY" },
        channel: "telegram",
      })
    );
    expect(db.requestWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(db.setWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(execution.ok).toBe(false);
    expect(execution.result).toContain("Settings");
  });

  it("refuses the request path when the run has no chat to answer in", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({ args: { name: "SENDGRID_API_KEY" }, chatId: undefined })
    );
    expect(db.requestWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(execution.ok).toBe(false);
  });

  it("rejects an invalid variable name before touching storage", async () => {
    const execution = await toolSetEnvVar(
      ctxFor({ args: { name: "1BAD-NAME", value: "x" } })
    );
    expect(execution.ok).toBe(false);
    expect(execution.result).toContain("not a valid environment variable name");
    expect(db.setWorkspaceEnvVarForUser).not.toHaveBeenCalled();
    expect(db.requestWorkspaceEnvVarForUser).not.toHaveBeenCalled();
  });
});
