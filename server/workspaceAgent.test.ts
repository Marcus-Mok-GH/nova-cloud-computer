import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(
    async (_owner: number, input: { role: string; content: string }) => ({
        id: 1,
        ...input,
    }),
);
const createFile = vi.fn(
    async (_owner: number, input: { name: string; content?: string }) => ({
        id: 2,
        ...input,
    }),
);
const createFolder = vi.fn(async (_owner: number, input: { name: string }) => ({
    id: 3,
    ...input,
}));
const updateFolder = vi.fn(
    async (
        _owner: number,
        id: number,
        input: { name?: string; parentId?: number | null },
    ) => ({
        id,
        name: input.name ?? "Notes",
        parentId: input.parentId ?? null,
    }),
);
const updateFile = vi.fn(
    async (
        _owner: number,
        id: number,
        input: { folderId?: number | null },
    ) => ({
        id,
        name: "welcome.md",
        folderId: input.folderId ?? null,
    }),
);
const deleteFile = vi.fn(async () => true);
const deleteFolder = vi.fn(async () => true);
const telegramCredentials = vi.fn(async () => undefined);
const computer = vi.fn(async () => ({
    workspace: { id: 41, persistentSandboxId: "sbx-vm" },
    folders: [
        { id: 10, name: "Notes" },
        { id: 11, name: "Archive" },
    ],
    files: [{ id: 15, name: "welcome.md" }],
}));
const chat = vi.fn(async () => ({
    id: 3,
    title: "New workspace conversation",
}));
const chatMessages = vi.fn(async () => [
    { id: 1, role: "user", content: "Help me plan a sprint." },
    { id: 2, role: "assistant", content: "Here is a two-week plan." },
]);
const renameChat = vi.fn(
    async (
        _owner: number,
        _chatId: number,
        title: string,
        _defaults: string[],
    ) => ({ id: 3, title }),
);

vi.mock("./db", () => ({
    appendChatMessageForUser: append,
    getChatForUser: chat,
    listChatMessagesForUser: chatMessages,
    renameChatIfDefaultForUser: renameChat,
    createWorkspaceFileForUser: createFile,
    createWorkspaceFolderForUser: createFolder,
    getWorkspaceComputer: computer,
    updateWorkspaceFolderForUser: updateFolder,
    updateWorkspaceFileForUser: updateFile,
    deleteWorkspaceFileForUser: deleteFile,
    deleteWorkspaceFolderForUser: deleteFolder,
    getTelegramCredentialsForUser: telegramCredentials,
}));

const completeWithNvidiaGateway = vi.fn();
const getNvidiaGatewayStatus = vi.fn(() => ({
    configured: true,
    reachable: true,
    providerConfigured: true,
    providerConfigurationKnown: true,
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    allowance: {
        usedRequests: 0,
        maxRequests: 50,
        remainingRequests: 50,
        exhausted: false,
    },
}));
class NvidiaGatewayClientError extends Error {
    kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response";
    constructor(message, kind) {
        super(message);
        this.name = "NvidiaGatewayClientError";
        this.kind = kind;
    }
}
vi.mock("./nvidiaGateway", () => ({
    completeWithNvidiaGateway,
    getNvidiaGatewayStatus,
    NvidiaGatewayClientError,
}));

// startAgentVmRun (imported by workspaceAgent) pulls the E2B client; keep a
// lightweight mock so the real e2b SDK is never loaded in the test worker.
vi.mock("./e2b", () => ({
    getE2BClient: vi.fn(),
    isE2BConfigured: vi.fn(() => false),
    runE2BTaskInPersistentSandbox: vi.fn(),
    ensurePersistentSandbox: vi.fn(),
    getE2BSandboxStatus: vi.fn(),
    withE2BWorkspaceLock: vi.fn(),
}));

vi.mock("./workspaceSync", () => ({
    persistE2BWorkspace: vi.fn(async () => 0),
    restoreWorkspaceToE2B: vi.fn(async () => 0),
}));

const { runWorkspaceAgent, autoTitleChatForUser } = await import(
    "./workspaceAgent"
);

const nvidiaResult = (text: string) => ({
    text,
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    usage: null,
    allowance: {
        usedRequests: 1,
        maxRequests: 50,
        remainingRequests: 49,
        exhausted: false,
    },
});

describe("Nova VM-agent workspace", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("creates a requested plain-text file without any hosted model key", async () => {
        const result = await runWorkspaceAgent(
            7,
            3,
            "Create a plain text file named welcome.md containing exactly: Hello from Nova.",
        );
        expect(createFile).toHaveBeenCalledWith(7, {
            name: "welcome.md",
            content: "Hello from Nova.",
        });
        expect(result.actions).toEqual([{ kind: "file", name: "welcome.md" }]);
        expect(append).toHaveBeenLastCalledWith(
            7,
            expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("welcome.md"),
            }),
        );
    });

    it("creates a requested folder directly without a model round-trip", async () => {
        const result = await runWorkspaceAgent(
            7,
            3,
            "Create a folder named Research.",
        );
        expect(createFolder).toHaveBeenCalledWith(7, { name: "Research" });
        expect(result.actions).toEqual([{ kind: "folder", name: "Research" }]);
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("creates a file from a natural 'write a file' request with content", async () => {
        await runWorkspaceAgent(
            7,
            3,
            "Write a file named groceries.txt saying milk and eggs",
        );
        expect(createFile).toHaveBeenCalledWith(7, {
            name: "groceries.txt",
            content: "milk and eggs",
        });
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("renames and moves folders through explicit direct requests", async () => {
        await expect(
            runWorkspaceAgent(7, 3, "Rename folder Notes to Research"),
        ).resolves.toMatchObject({
            actions: [
                { kind: "folder", operation: "renamed", name: "Research" },
            ],
        });
        await expect(
            runWorkspaceAgent(7, 3, "Move folder Notes into folder Archive"),
        ).resolves.toMatchObject({
            actions: [{ kind: "folder", operation: "moved", name: "Notes" }],
        });
        expect(updateFolder).toHaveBeenCalledWith(7, 10, { parentId: 11 });
    });

    it("moves a file directly", async () => {
        await expect(
            runWorkspaceAgent(7, 3, "Move file welcome.md into folder Archive"),
        ).resolves.toMatchObject({
            actions: [{ kind: "file", operation: "moved", name: "welcome.md" }],
        });
        expect(updateFile).toHaveBeenCalledWith(7, 15, { folderId: 11 });
    });

    it("deletes a requested file even when the sentence ends with punctuation", async () => {
        await expect(
            runWorkspaceAgent(7, 3, "Delete file welcome.md."),
        ).resolves.toMatchObject({
            actions: [
                { kind: "file", operation: "deleted", name: "welcome.md" },
            ],
        });
        expect(deleteFile).toHaveBeenCalledWith(7, 15);
    });

    it("deletes a requested folder directly", async () => {
        const result = await runWorkspaceAgent(7, 3, "Delete folder Archive");
        expect(deleteFolder).toHaveBeenCalledWith(7, 11);
        expect(result.actions).toEqual([
            { kind: "folder", operation: "deleted", name: "Archive" },
        ]);
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("returns a conversational reply via NVIDIA NIM", async () => {
        completeWithNvidiaGateway.mockResolvedValue(
            nvidiaResult("Hello from NVIDIA NIM."),
        );

        await expect(
            runWorkspaceAgent(
                7,
                3,
                "Please reply with exactly this one word: PINEAPPLE.",
            ),
        ).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: "Hello from NVIDIA NIM.",
            }),
        });

        expect(completeWithNvidiaGateway).toHaveBeenCalledWith(
            7,
            expect.stringContaining("PINEAPPLE"),
            undefined,
            expect.any(Function),
        );
    });

    it("streams conversational chunks through onChunk while persisting the final reply", async () => {
        completeWithNvidiaGateway.mockImplementationOnce(
            async (_owner, _prompt, _model, onChunk) => {
                for (const part of ["Streaming", " replies", " now"])
                    onChunk?.(part);
                return nvidiaResult("Streaming replies now");
            },
        );

        const chunks: string[] = [];
        await expect(
            runWorkspaceAgent(7, 3, "Tell me about streaming replies.", {
                onChunk: (chunk) => chunks.push(chunk),
            }),
        ).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: "Streaming replies now",
            }),
        });

        expect(chunks).toEqual(["Streaming", " replies", " now"]);
        expect(completeWithNvidiaGateway).toHaveBeenCalledWith(
            7,
            expect.stringContaining("Tell me about streaming replies."),
            undefined,
            expect.any(Function),
        );
    });

    it("reports NVIDIA is unavailable when the completion throws", async () => {
        completeWithNvidiaGateway.mockRejectedValue(new Error("gateway down"));
        await expect(
            runWorkspaceAgent(
                7,
                3,
                "Please reply with exactly this one word: PINEAPPLE.",
            ),
        ).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("NVIDIA"),
            }),
        });
    });

    it("reports configuration error when the gateway is not configured", async () => {
        getNvidiaGatewayStatus.mockResolvedValueOnce({
            configured: false,
            reachable: false,
            providerConfigured: false,
            providerConfigurationKnown: false,
            allowance: {
                usedRequests: 0,
                maxRequests: 50,
                remainingRequests: 50,
                exhausted: false,
            },
        });
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("not configured"),
            }),
        });
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("reports unreachable gateway when health check fails", async () => {
        getNvidiaGatewayStatus.mockResolvedValueOnce({
            configured: true,
            reachable: false,
            providerConfigured: false,
            providerConfigurationKnown: true,
            allowance: {
                usedRequests: 0,
                maxRequests: 50,
                remainingRequests: 50,
                exhausted: false,
            },
        });
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("unreachable"),
            }),
        });
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("reports allowance exhausted when request cap is reached", async () => {
        getNvidiaGatewayStatus.mockResolvedValueOnce({
            configured: true,
            reachable: true,
            providerConfigured: true,
            providerConfigurationKnown: true,
            allowance: {
                usedRequests: 50,
                maxRequests: 50,
                remainingRequests: 0,
                exhausted: true,
            },
        });
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("exhausted"),
            }),
        });
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    });

    it("returns rate-limit message when completion throws a rate_limit error", async () => {
        completeWithNvidiaGateway.mockRejectedValue(
            new NvidiaGatewayClientError("rate limited", "rate_limit"),
        );
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("allowance"),
            }),
        });
    });

    it("returns configuration message when completion throws a configuration error", async () => {
        completeWithNvidiaGateway.mockRejectedValue(
            new NvidiaGatewayClientError("not connected", "configuration"),
        );
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("not connected"),
            }),
        });
    });

    it("returns invalid-response message when completion throws an invalid_response error", async () => {
        completeWithNvidiaGateway.mockRejectedValue(
            new NvidiaGatewayClientError("bad response", "invalid_response"),
        );
        await expect(runWorkspaceAgent(7, 3, "Hello")).resolves.toMatchObject({
            actions: [],
            message: expect.objectContaining({
                role: "assistant",
                content: expect.stringContaining("invalid response"),
            }),
        });
    });
});

describe("autoTitleChatForUser", () => {
    afterEach(() => {
        chat.mockImplementation(async () => ({
            id: 3,
            title: "New workspace conversation",
        }));
        chatMessages.mockImplementation(async () => [
            { id: 1, role: "user", content: "Help me plan a sprint." },
            { id: 2, role: "assistant", content: "Here is a two-week plan." },
        ]);
        vi.clearAllMocks();
    });

    it("renames a default-titled chat from its first messages via NVIDIA NIM", async () => {
        completeWithNvidiaGateway.mockResolvedValue(
            nvidiaResult("Sprint planning help"),
        );
        await autoTitleChatForUser(7, 3);
        expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint planning help", [
            "New workspace conversation",
            "New conversation",
            "Telegram Chat",
        ]);
    });

    it("leaves already-titled chats alone", async () => {
        chat.mockResolvedValue({ id: 3, title: "Sprint planning help" });
        await autoTitleChatForUser(7, 3);
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
        expect(renameChat).not.toHaveBeenCalled();
    });

    it("does nothing before the first assistant reply", async () => {
        chatMessages.mockResolvedValue([
            { id: 1, role: "user", content: "Hello?" },
        ]);
        await autoTitleChatForUser(7, 3);
        expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
        expect(renameChat).not.toHaveBeenCalled();
    });

    it("strips wrapping quotes and newlines from the model title", async () => {
        completeWithNvidiaGateway.mockResolvedValue(
            nvidiaResult('""Sprint\nplanning"\n'),
        );
        await autoTitleChatForUser(7, 3);
        expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint", [
            "New workspace conversation",
            "New conversation",
            "Telegram Chat",
        ]);
    });

    it("does not rename when the NVIDIA title is missing", async () => {
        completeWithNvidiaGateway.mockResolvedValue(nvidiaResult(""));
        await autoTitleChatForUser(7, 3);
        expect(renameChat).not.toHaveBeenCalled();
    });
});
