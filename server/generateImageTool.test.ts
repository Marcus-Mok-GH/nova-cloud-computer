/**
 * The generate_image agent tool: the daily allowance is claimed before the
 * provider call and given back when it fails, and a successful generation is
 * stored as a workspace file AND carried back so the chat can show it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toolGenerateImage } from "./workspaceTools/image";
import type { ToolCtx } from "./workspaceTools/types";

const db = vi.hoisted(() => ({
  claimImageGenerationForUser: vi.fn(),
  releaseImageGenerationClaimForUser: vi.fn(),
  getImageGenerationStatusForUser: vi.fn(),
  createWorkspaceFileForUser: vi.fn(),
}));

vi.mock("./db/imageQuotas", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./db/imageQuotas")>();
  return { ...actual, ...db };
});

vi.mock("./db/workspaceFiles", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./db/workspaceFiles")>();
  return { ...actual, createWorkspaceFileForUser: db.createWorkspaceFileForUser };
});

const generation = vi.hoisted(() => ({
  generatePollinationsImage: vi.fn(),
}));

vi.mock("./imageGeneration", async importOriginal => {
  const actual = await importOriginal<typeof import("./imageGeneration")>();
  return { ...actual, generatePollinationsImage: generation.generatePollinationsImage };
});

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** A minimal per-call context; only the fields this family reads are set. */
const ctxFor = (overrides: Partial<ToolCtx> = {}) =>
  ({
    ownerId: 1,
    args: {},
    str: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
    folderRows: [],
    mirror: vi.fn(async () => {}),
    channel: "web",
    chatId: "chat-1",
    ...overrides,
  }) as ToolCtx;

describe("generate_image", () => {
  const originalKey = process.env.POLLINATIONS_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.POLLINATIONS_API_KEY = "test-key";
    db.claimImageGenerationForUser.mockResolvedValue({
      usedImages: 1,
      limit: 3,
    });
    db.getImageGenerationStatusForUser.mockResolvedValue({
      quotaDay: "2026-11-18",
      limit: 3,
      unlimited: false,
      usedImages: 3,
      remainingImages: 0,
    });
    db.releaseImageGenerationClaimForUser.mockResolvedValue(undefined);
    db.createWorkspaceFileForUser.mockImplementation(
      async (
        _ownerId: number,
        input: { name: string; content?: string; mimeType?: string }
      ) => ({
        id: 42,
        name: input.name,
        content: input.content ?? "",
        mimeType: "image/png",
        folderId: null,
        workspaceId: 7,
        createdAt: new Date("2026-11-18T00:00:00Z"),
        updatedAt: new Date("2026-11-18T00:00:00Z"),
      })
    );
    generation.generatePollinationsImage.mockResolvedValue({
      dataUri: IMAGE,
      mimeType: "image/png",
      extension: "png",
    });
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.POLLINATIONS_API_KEY;
    else process.env.POLLINATIONS_API_KEY = originalKey;
  });

  it("claims a slot, generates, and saves the image as a workspace file", async () => {
    const execution = await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox", aspect_ratio: "portrait" } })
    );

    expect(db.claimImageGenerationForUser).toHaveBeenCalledWith(1);
    expect(generation.generatePollinationsImage).toHaveBeenCalledWith({
      prompt: "a red fox",
      apiKey: "test-key",
      aspectRatio: "portrait",
    });
    const [ownerId, file] = db.createWorkspaceFileForUser.mock.calls[0] as [
      number,
      { name: string; content: string; mimeType: string },
    ];
    expect(ownerId).toBe(1);
    expect(file.content).toBe(IMAGE);
    expect(file.mimeType).toBe("image/png");
    expect(file.name).toMatch(/^a-red-fox-\d{14}-[a-z0-9]{5}\.png$/);
    expect(execution.ok).toBe(true);
    expect(execution.generatedImage).toBe(IMAGE);
    expect(execution.action).toMatchObject({
      kind: "image",
      operation: "created",
    });
    // A failed generation must never consume the day's allowance.
    expect(db.releaseImageGenerationClaimForUser).not.toHaveBeenCalled();
  });

  it("refuses an empty or oversized prompt without claiming a slot", async () => {
    const empty = await toolGenerateImage(ctxFor({ args: { prompt: "   " } }));
    expect(empty.ok).toBe(false);
    const long = await toolGenerateImage({
      ...ctxFor(),
      args: { prompt: "x".repeat(2_001) },
    });
    expect(long.ok).toBe(false);
    expect(db.claimImageGenerationForUser).not.toHaveBeenCalled();
    expect(generation.generatePollinationsImage).not.toHaveBeenCalled();
  });

  it("does not claim a slot when the server has no provider key", async () => {
    delete process.env.POLLINATIONS_API_KEY;
    const execution = await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox" } })
    );
    expect(execution.ok).toBe(false);
    expect(execution.result).toContain("not set up");
    expect(db.claimImageGenerationForUser).not.toHaveBeenCalled();
    expect(generation.generatePollinationsImage).not.toHaveBeenCalled();
  });

  it("reports the plan's cap when the day's allowance is spent", async () => {
    db.claimImageGenerationForUser.mockResolvedValue(undefined);
    const execution = await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox" } })
    );
    expect(execution.ok).toBe(false);
    expect(execution.result).toContain("all 3 of today's image generations");
    expect(execution.result).toContain("resets at UTC midnight");
    expect(generation.generatePollinationsImage).not.toHaveBeenCalled();
    // Nothing was claimed, so nothing is refunded.
    expect(db.releaseImageGenerationClaimForUser).not.toHaveBeenCalled();
  });

  it("gives the slot back when the provider call fails", async () => {
    generation.generatePollinationsImage.mockRejectedValue(
      new Error("Pollinations image generation failed (503).")
    );
    const execution = await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox" } })
    );
    expect(execution.ok).toBe(false);
    expect(execution.result).toContain("could not be generated");
    expect(db.releaseImageGenerationClaimForUser).toHaveBeenCalledWith(1);
    expect(db.createWorkspaceFileForUser).not.toHaveBeenCalled();
  });

  it("still shows the picture when saving it to the workspace fails", async () => {
    db.createWorkspaceFileForUser.mockResolvedValue(undefined);
    const execution = await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox" } })
    );
    expect(execution.ok).toBe(false);
    expect(execution.generatedImage).toBe(IMAGE);
    expect(execution.result).toContain("not among their files");
  });

  it("mirrors onto a live sandbox when the run already woke one", async () => {
    const mirror = vi.fn(async (_op: unknown) => {});
    await toolGenerateImage(
      ctxFor({ args: { prompt: "a red fox" }, mirror, sandbox: {} as never })
    );
    expect(mirror).toHaveBeenCalledTimes(1);
    expect(mirror.mock.calls[0][0]).toMatchObject({
      kind: "write_file",
      path: expect.stringMatching(/^a-red-fox-\d{14}-[a-z0-9]{5}\.png$/),
      content: IMAGE,
    });
  });
});
