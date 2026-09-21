import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/** Circular "+" floating action button pinned near the bottom-right corner.
 * Creates a new chat and enters it. */
export default function NewChatButton() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const create = trpc.chats.create.useMutation({ onSuccess: () => utils.workspace.computer.invalidate() });

  const startNewChat = async () => {
    if (create.isPending) return;
    try {
      const chat = await create.mutateAsync({ title: "New workspace conversation" });
      setLocation(`/app?chatId=${chat.id}`);
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
      className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6 z-40 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_8px_24px_rgba(10,10,10,0.18)] transition hover:bg-primary/90 active:scale-95 disabled:opacity-60 dark:text-background"
    >
      <Plus className="size-6" />
    </button>
  );
}
