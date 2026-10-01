import { customAlphabet } from "nanoid";

/**
 * Random, URL-safe identifier for a chat conversation.
 *
 * Chats used to expose sequential integer ids in their links (for example
 * `/app?chatId=42`), which let anyone enumerate other people's conversations by
 * counting. Ten lowercase alphanumeric characters give ~3.6e15 possibilities,
 * making ids unpredictable while staying short enough to paste and read.
 */
const CHAT_ID_LENGTH = 10;
const CHAT_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

const generateChatId = customAlphabet(CHAT_ID_ALPHABET, CHAT_ID_LENGTH);

/** Returns a fresh random chat id, e.g. "k3f9q2m7zt". */
export function newChatId(): string {
  return generateChatId();
}
