export async function* readChatStreamEvents(
  response: Response
): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream not supported");

  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) {
            if (data === "[DONE]") {
              completed = true;
              yield data;
              return;
            }
            yield data;
          }
        }
        newline = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    const finalLine = buffer.replace(/\r$/, "");
    if (finalLine.startsWith("data:")) {
      const data = finalLine.slice(5).trim();
      if (data === "[DONE]") {
        completed = true;
        yield data;
        return;
      }
      if (data) yield data;
    }

    if (!completed)
      throw new Error(
        "Connection ended before Nova confirmed completion. Check the chat before retrying."
      );
  } finally {
    reader.releaseLock();
  }
}
