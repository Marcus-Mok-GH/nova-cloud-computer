import React from "react";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

/** Circular "+" floating action button pinned near the bottom-right corner.
 * Starts a new chat: it takes the visitor to the workspace, where the
 * task-prompt screen creates the conversation on first send - so this
 * button pre-creates nothing and no stray archive row ever appears. */
export default function NewChatButton() {
  const [, setLocation] = useLocation();

  return (
    <button
      onClick={() => setLocation("/app")}
      aria-label="New chat"
      title="New chat"
      className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] end-6 z-40 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_8px_24px_rgba(10,10,10,0.18)] transition hover:bg-primary/90 active:scale-95 disabled:opacity-60 dark:text-background"
    >
      <Plus className="size-6" />
    </button>
  );
}
