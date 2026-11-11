import React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** Circular "+" floating action button pinned near the bottom-right corner.
 * Creates a new chat that then appears in the /app/chats archive, so the
 * visitor stays on the page instead of being redirected into the /app
 * thread view. */
export default function NewChatButton() {
  const utils = trpc.useUtils();
  const create = trpc.chats.create.useMutation({ onSuccess: () => Promise.all([utils.workspace.chats.invalidate(), utils.workspace.computer.invalidate()]) });

  const startNewChat = async () => {
    if (create.isPending) return;
    try {
      // Refetches in onSuccess push the new conversation to the top of the
      // archive; the page itself is left alone.
      await create.mutateAsync({ title: "New workspace conversation" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Nova could not start that conversation.");
    }
  };

  return (
    <button
      onClick={() => void startNewChat()}
      disabled={create.isPending}
      aria-label="New chat"
      title="New chat"
      className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] end-6 z-40 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_8px_24px_rgba(10,10,10,0.18)] transition hover:bg-primary/90 active:scale-95 disabled:opacity-60 dark:text-background"
    >
      <Plus className="size-6" />
    </button>
  );
}
