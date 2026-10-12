import { useSyncExternalStore } from "react";

/**
 * Chats the reader has left while a turn was still running. A turn can settle
 * after the reader has moved on, so both the chat list and the thread header
 * need to know which conversations have something new waiting - and they live
 * on different screens, so the marker has to outlive both the Workspace
 * component and, since a turn can finish after a reload, the page itself.
 *
 * This is a plain module-level store rather than React state: it is written
 * when a stream is abandoned (possibly as Workspace unmounts) and read by
 * whichever screen mounts next. Markers are mirrored to localStorage so a
 * reload does not lose them, and a chat is removed again the moment it is
 * opened, so the marker is consumed exactly once.
 */
const STORAGE_KEY = "nova.awayChats";

function readStoredAwayChatIds(): readonly string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function persistAwayChatIds(): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (awayChatIds.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(awayChatIds));
  } catch {
    // Storage can be full or blocked (private mode); the in-memory marker still works.
  }
}

let awayChatIds: readonly string[] = readStoredAwayChatIds();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

/** Records that `chatId` was left with a turn still in flight. Idempotent. */
export function markChatAway(chatId: string | undefined): void {
  if (!chatId || awayChatIds.includes(chatId)) return;
  awayChatIds = [...awayChatIds, chatId];
  persistAwayChatIds();
  emit();
}

/**
 * Clears the marker for `chatId`, returning whether it was set. Opening a chat
 * consumes the marker so neither the list badge nor the header pill lingers.
 */
export function consumeChatAway(chatId: string): boolean {
  if (!awayChatIds.includes(chatId)) return false;
  awayChatIds = awayChatIds.filter(id => id !== chatId);
  persistAwayChatIds();
  emit();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): readonly string[] {
  return awayChatIds;
}

/** The list of marked chats, kept in sync across the list and the thread. */
export function useAwayChats(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
