import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AwayChatsModule = typeof import("./awayChats");

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

/** Import a fresh module instance, as a page reload would. */
async function loadStore(): Promise<AwayChatsModule> {
  vi.resetModules();
  return import("./awayChats");
}

describe("away chats store", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks a chat away once and consumes the marker exactly once", async () => {
    const { consumeChatAway, markChatAway } = await loadStore();
    expect(consumeChatAway("chat-list-a")).toBe(false);
    markChatAway("chat-list-a");
    markChatAway("chat-list-a");
    // Opening the chat consumes the marker; a second open finds nothing.
    expect(consumeChatAway("chat-list-a")).toBe(true);
    expect(consumeChatAway("chat-list-a")).toBe(false);
  });

  it("ignores empty or missing chat ids", async () => {
    const { consumeChatAway, markChatAway } = await loadStore();
    markChatAway(undefined);
    markChatAway("");
    expect(consumeChatAway("")).toBe(false);
  });

  it("keeps each chat's marker independent", async () => {
    const { consumeChatAway, markChatAway } = await loadStore();
    markChatAway("chat-list-b");
    markChatAway("chat-list-c");
    expect(consumeChatAway("chat-list-b")).toBe(true);
    expect(consumeChatAway("chat-list-c")).toBe(true);
  });

  it("restores markers after a reload", async () => {
    const first = await loadStore();
    first.markChatAway("chat-reload");
    first.consumeChatAway("chat-other");
    // A fresh module instance reads the same storage a reloaded page would.
    const reloaded = await loadStore();
    expect(reloaded.consumeChatAway("chat-reload")).toBe(true);
    expect(reloaded.consumeChatAway("chat-reload")).toBe(false);
  });

  it("stops persisting a chat once it is consumed", async () => {
    const first = await loadStore();
    first.markChatAway("chat-consumed");
    expect(first.consumeChatAway("chat-consumed")).toBe(true);
    const reloaded = await loadStore();
    expect(reloaded.consumeChatAway("chat-consumed")).toBe(false);
  });

  it("ignores corrupt or non-string stored values", async () => {
    localStorage.setItem("nova.awayChats", "not json");
    expect((await loadStore()).consumeChatAway("chat-corrupt")).toBe(false);

    localStorage.setItem("nova.awayChats", JSON.stringify({ chat: true }));
    expect((await loadStore()).consumeChatAway("chat-object")).toBe(false);

    localStorage.setItem("nova.awayChats", JSON.stringify(["ok", 42, "", null]));
    const store = await loadStore();
    expect(store.consumeChatAway("ok")).toBe(true);
    expect(store.consumeChatAway("42")).toBe(false);
  });
});
