import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentRuns, chatMessages, chats, customModels, workspaceFiles, workspaceFolders, workspaceSettings, workspaces } from "../drizzle/schema";

/**
 * The read paths the app hits on every poll are budgeted by round trip, not by
 * row: each drizzle statement on the Neon HTTP driver is its own request. These
 * tests pin the counts so a future helper cannot quietly reintroduce the extra
 * workspace lookup each one used to make.
 *
 * Only statements that are actually awaited count. A subquery is embedded in
 * its parent's SQL, so building one is free.
 */

const workspace = { id: 42, ownerId: 7, name: "My Nova Space", persistentSandboxId: "sbx-1" };

let statements: string[] = [];

function nameOf(table: unknown) {
  if (table === workspaces) return "workspaces";
  if (table === agentRuns) return "agentRuns";
  if (table === chats) return "chats";
  if (table === chatMessages) return "chatMessages";
  if (table === workspaceFiles) return "workspaceFiles";
  if (table === workspaceFolders) return "workspaceFolders";
  if (table === workspaceSettings) return "workspaceSettings";
  if (table === customModels) return "customModels";
  return "unknown";
}

function rowsFor(table: unknown) {
  switch (nameOf(table)) {
    case "workspaces":
      return [workspace];
    case "chats":
      return [{ id: "chat-1", workspaceId: workspace.id, title: "First" }];
    case "workspaceSettings":
      return [{ id: 3, workspaceId: workspace.id, communicationStyle: null }];
    default:
      return [];
  }
}

function execute(table: unknown) {
  statements.push(nameOf(table));
  return Promise.resolve(rowsFor(table));
}

/** A drizzle query chain: nothing is recorded until the statement runs. */
function chain(table: unknown): unknown {
  const node: Record<string, unknown> = {
    where: () => chain(table),
    orderBy: () => chain(table),
    limit: () => execute(table),
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      execute(table).then(resolve, reject),
  };
  return node;
}

const fakeDb = {
  select: () => ({ from: (table: unknown) => chain(table) }),
  insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined, returning: async () => [] }) }),
  update: () => ({ set: () => ({ where: async () => undefined }) }),
  delete: () => ({ where: async () => undefined }),
};

vi.mock("@neondatabase/serverless", () => ({ neon: vi.fn(() => ({})) }));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: vi.fn(() => fakeDb) }));

const { getActiveAgentRunInChat, getChatForUser, getWorkspaceComputer } = await import("./db");

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
  statements = [];
});

describe("database round-trip budget", () => {
  it("resolves an owned chat in one statement", async () => {
    const chat = await getChatForUser(7, "chat-1");
    expect(chat).toMatchObject({ id: "chat-1" });
    expect(statements).toEqual(["chats"]);
  });

  it("loads the workspace snapshot with one lookup plus one read per collection", async () => {
    const computer = await getWorkspaceComputer(7);
    expect(computer.workspace).toMatchObject({ id: 42 });
    // One workspace row, then folders, files, chats, settings and custom models:
    // six statements instead of the eleven this path used to issue.
    expect([...statements].sort()).toEqual(
      ["workspaces", "workspaceFolders", "workspaceFiles", "chats", "workspaceSettings", "customModels"].sort()
    );
  });

  it("reads a chat's live run by the already-resolved chat id", async () => {
    await getActiveAgentRunInChat("chat-1");
    expect(statements).toEqual(["agentRuns"]);
  });
});
