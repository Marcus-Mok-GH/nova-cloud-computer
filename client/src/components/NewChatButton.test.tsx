import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app/chats", mocks.setLocation] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      workspace: {
        chats: { invalidate: mocks.invalidate },
        computer: { invalidate: mocks.invalidate },
      },
    }),
    chats: {
      create: {
        useMutation: (options: { onSuccess?: () => Promise<void> }) => ({
          isPending: false,
          mutateAsync: async (input: { title: string }) => {
            const chat = await mocks.mutateAsync(input);
            await options.onSuccess?.();
            return chat;
          },
        }),
      },
    },
  },
}));
import NewChatButton from "./NewChatButton";
import { useLocation } from "wouter";

describe("NewChatButton", () => {
  it("starts a new chat at /app without pre-creating a conversation", async () => {
    // Guard: wouter must be mocked, or the navigation assertions would
    // never see the real call.
    const [, nav] = useLocation();
    expect(nav).toBe(mocks.setLocation);

    // Every hook the component uses is mocked, so calling it directly
    // yields the button element and its real click handler without a DOM.
    const element = NewChatButton();
    element.props.onClick();

    expect(mocks.setLocation).toHaveBeenCalledTimes(1);
    expect(mocks.setLocation).toHaveBeenCalledWith("/app");
    // Nothing is created up front: no stray "New workspace conversation"
    // row to clean out of the archive later.
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
