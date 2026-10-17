/**
 * The workspace agent's Telegram tool family: send_telegram_message,
 * send_progress_update and present_file. Called by the executor with the
 * per-call context built there.
 */
import { getTelegramCredentialsForUser } from "../db";
import {
  presentTelegramFile,
  sendTelegramMessage,
} from "../telegram";
import { fileNotFoundResult, resolveFile } from "./resolve";
import { type ToolCtx, type ToolExecution } from "./types";

export async function toolSendTelegramMessage(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, ownerId } = ctx;
  const text = str(args.text);
  if (!text) return { ok: false, result: "Message text is required." };
  const credentials = await getTelegramCredentialsForUser(ownerId);
  if (!credentials?.chatId)
    return {
      ok: false,
      result:
        "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
    };
  const sent = await sendTelegramMessage(
    credentials.token,
    credentials.chatId,
    text
  );
  return {
    ok: true,
    result: `Sent the Telegram message (message #${sent.message_id}).`,
    action: { kind: "telegram", name: text, operation: "sent" },
  };
}

export async function toolSendProgressUpdate(ctx: ToolCtx): Promise<ToolExecution> {
  const { args, str, channel, ownerId } = ctx;
  const text = str(args.text);
  if (!text)
    return { ok: false, result: "A progress note text is required." };
  if (channel !== "telegram")
    return {
      ok: false,
      result:
        "send_progress_update is only available over Telegram - the web app already shows the user your tool activity live, so just do the work and deliver the result with end_turn.",
    };
  const credentials = await getTelegramCredentialsForUser(ownerId);
  if (!credentials?.chatId)
    return {
      ok: false,
      result:
        "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
    };
  const sent = await sendTelegramMessage(
    credentials.token,
    credentials.chatId,
    text
  );
  return {
    ok: true,
    result: `Sent the progress update (message #${sent.message_id}).`,
    action: { kind: "telegram", name: text, operation: "sent" },
  };
}

export async function toolPresentFile(ctx: ToolCtx): Promise<ToolExecution> {
  const { computer, args, str, ownerId } = ctx;
  const file = resolveFile(computer, args.file);
  if (!file)
    return { ok: false, result: fileNotFoundResult(computer, args.file) };
  const credentials = await getTelegramCredentialsForUser(ownerId);
  if (!credentials?.chatId)
    return {
      ok: false,
      result:
        "Telegram is not connected. Tell the user to connect Telegram in Settings, send /start to their bot, and discover its chat first.",
    };
  try {
    const presented = await presentTelegramFile(
      credentials.token,
      credentials.chatId,
      {
        name: file.name,
        content: String(file.content ?? ""),
        mimeType: file.mimeType,
      },
      str(args.caption) || undefined
    );
    return {
      ok: true,
      result: `Presented ${file.name} to the user as a ${presented.as} (message #${presented.messageId}) - they can view or download it in the chat.`,
      action: { kind: "file", name: file.name, operation: "presented" },
    };
  } catch (error) {
    return {
      ok: false,
      result: `Could not present ${file.name}: ${error instanceof Error ? error.message : "Telegram rejected the file."}`,
    };
  }
}
