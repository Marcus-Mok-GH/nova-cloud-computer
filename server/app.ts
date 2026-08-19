import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { sdk } from "./_core/sdk";
import { runAutomationForScheduleTask } from "./automations";
import {
  appendChatMessageForUser,
  getWorkspaceComputer,
  listChatMessagesForUser,
  updateChatForUser,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { getWorkspaceAgentConnection, runWorkspaceAgent } from "./workspaceAgent";

export const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));
app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

/**
 * Platform-owned cron callbacks authenticate to a persisted, opaque task UID.
 * The UID is resolved in the database, never accepted from request payloads.
 */
app.post("/api/scheduled/automation", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });

    const outcome = await runAutomationForScheduleTask(user.taskUid);
    if (!outcome) return res.status(200).json({ ok: true, skipped: "orphaned-schedule" });
    if (outcome.failed > 0) {
      throw new Error("The scheduled automation recorded a failed run and will be retried.");
    }

    return res.status(200).json({ ok: true, outcome });
  } catch (error) {
    console.error("[Automation schedule] Callback failed", error);
    return res.status(500).json({
      error: "automation-callback-failed",
      timestamp: new Date().toISOString(),
      context: { path: req.path },
    });
  }
});

app.post("/api/chat/stream", async (req: express.Request, res: express.Response) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { chatId, content } = req.body ?? {};
    if (!chatId || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Missing chatId or content" });
    }

    await appendChatMessageForUser(user.id, { chatId, role: "user", content: content.trim() });

    const connection = await getWorkspaceAgentConnection(user.id);
    if (!connection) {
      return res.status(500).json({ error: "No LLM connection configured" });
    }

    const computer = await getWorkspaceComputer(user.id);
    const context = `You are Nova, a concise helpful agent inside a private computer workspace. Use tools only for explicit create, rename, move, delete, Telegram-send, or VM requests. Run a VM only when the user specifically asks to use a VM or sandbox; the VM has no network access and receives only the current workspace bundle. Send Telegram only if the user clearly asks you to send the supplied text. Current folders: ${computer.folders.map(folder => folder.name).join(", ") || "none"}. Current files: ${computer.files.map(file => file.name).join(", ") || "none"}. Explain completed actions briefly.`;

    const recent = await listChatMessagesForUser(user.id, chatId);
    const history = (recent ?? []).slice(-20).map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    const nimUrl = `${(connection.apiUrl ?? "https://integrate.api.nvidia.com/v1").replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(nimUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${connection.apiKey}`,
      },
      body: JSON.stringify({
        model: connection.model,
        messages: [{ role: "system", content: context }, ...history],
        stream: true,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: `Upstream error: ${response.status} ${response.statusText}`, details: errorText });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = response.body?.getReader();
    if (!reader) {
      return res.status(500).json({ error: "No stream available" });
    }
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6).trim();
          if (data === "[DONE]") {
            try {
              await appendChatMessageForUser(user.id, { chatId, role: "assistant", content: fullContent });
            } catch (persistError) {
              console.error("Failed to persist streamed message", persistError);
            }

            try {
              const messages = await listChatMessagesForUser(user.id, chatId);
              if (messages?.length === 2) {
                const firstUser = messages.find(m => m.role === "user");
                const firstAssistant = messages.find(m => m.role === "assistant");
                if (firstUser && firstAssistant) {
                  const title = await invokeLLM({
                    model: "z-ai/glm-5.2",
                    apiUrl: connection.apiUrl,
                    apiKey: connection.apiKey,
                    messages: [
                      { role: "system", content: "Generate a 3-6 word title for this conversation." },
                      { role: "user", content: `${firstUser.content}\n\n${firstAssistant.content}` },
                    ],
                    maxTokens: 20,
                  });
                  const titleString = ((title?.choices?.[0]?.message?.content ?? "") as string).trim();
                  const normalizedTitle = titleString ? titleString.slice(0, 60) : "New conversation";
                  await updateChatForUser(user.id, chatId, normalizedTitle);
                }
              }
            } catch (titleError) {
              console.error("Failed to generate chat title from stream", titleError);
            }

            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const token = parsed.choices?.[0]?.delta?.content || "";
            fullContent += token;
            res.write(`${trimmed}\n\n`);
          } catch {
            // skip malformed chunk
          }
        }
      }
    } catch (streamError) {
      console.error("Chat stream interrupted", streamError);
    }

    if (fullContent) {
      try {
        await appendChatMessageForUser(user.id, { chatId, role: "assistant", content: fullContent });
      } catch (persistError) {
        console.error("Failed to persist streamed message", persistError);
      }

      try {
        const messages = await listChatMessagesForUser(user.id, chatId);
        if (messages?.length === 2) {
          const firstUser = messages.find(m => m.role === "user");
          const firstAssistant = messages.find(m => m.role === "assistant");
          if (firstUser && firstAssistant) {
            const title = await invokeLLM({
              model: "z-ai/glm-5.2",
              apiUrl: connection.apiUrl,
              apiKey: connection.apiKey,
              messages: [
                { role: "system", content: "Generate a 3-6 word title for this conversation." },
                { role: "user", content: `${firstUser.content}\n\n${firstAssistant.content}` },
              ],
              maxTokens: 20,
            });
            const titleString = ((title?.choices?.[0]?.message?.content ?? "") as string).trim();
            const normalizedTitle = titleString ? titleString.slice(0, 60) : "New conversation";
            await updateChatForUser(user.id, chatId, normalizedTitle);
          }
        }
      } catch (titleError) {
        console.error("Failed to generate chat title from stream", titleError);
      }
    }

    res.end();
  } catch (error) {
    console.error("Chat stream endpoint error", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Stream failed" });
    } else {
      res.end();
    }
  }
});

app.get("/api/health", (_req: express.Request, res: express.Response) => res.status(200).json({ ok: true, service: "nova" }));
