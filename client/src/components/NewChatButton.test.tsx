import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLocation: vi.fn(),
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/app/chats", mocks.setLocation] }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
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
        useMutation: (options: { onSuccess: () => Promise<void> }) => ({
          isPending: false,
          mutateAsync: async (input: { title: string }) => {
            const chat = await mocks.mutateAsync(input);
            await options.onSuccess();
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
  beforeEach(() => {
    mocks.mutateAsync.mockClear();
    mocks.invalidate.mockClear();
    mocks.toastError.mockClear();
    mocks.setLocation.mockClear();
  });

  it("creates the conversation and stays on the /app/chats archive instead of redirecting to /app", async () => {
    // Guard the negative assertion below: if wouter were not mocked, calling
    // setLocation outside a Router would not reach our spy and "not called"
    // would prove nothing.
    const [, nav] = useLocation();
    expect(nav).toBe(mocks.setLocation);

    mocks.mutateAsync.mockResolvedValue({ id: "chat-123" });
    // Every hook the component uses is mocked, so calling it directly yields
    // the button element and its real click handler without a DOM.
    const element = NewChatButton();
    // onClick swallows the promise (`void startNewChat()`), so kick it off and
    // wait for the whole create flow to settle (both refetches) before
    // asserting on its effects.
    element.props.onClick();
    await vi.waitFor(() => {
      expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith({ title: "New workspace conversation" });
    // The archive and the workspace view both refetch so the new chat shows up.
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    // The visitor stays on /app/chats — no jump to the /app thread view.
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });

  it("surfaces a create failure as a toast and still stays put", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("database is down"));
    const element = NewChatButton();
    element.props.onClick();
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
    });

    expect(mocks.toastError).toHaveBeenCalledWith("database is down");
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.setLocation).not.toHaveBeenCalled();
  });
});
