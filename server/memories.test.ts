import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendConversationTurn,
  buildS3PutRequest,
  deleteMemoryForUser,
  listRecentMemoriesForPrompt,
  readMemoryForUser,
  saveMemoryForUser,
  searchMemoriesForUser,
} from "./memories";
import { getDb } from "./db";

vi.mock("./db", () => ({ getDb: vi.fn() }));

/**
 * Chainable stand-in for the drizzle query builder: select chains resolve
 * to the store's rows, insert/update/delete chains resolve to whatever the
 * store's handlers produce. The where-clause objects are captured but not
 * evaluated - filtering semantics belong to Postgres and are exercised by
 * the real database, not faked here.
 */
type Row = Record<string, unknown>;
const makeFakeDb = (store: {
  rows?: Row[];
  onInsert?: (values: Row) => Row;
  onUpdate?: (values: Row) => Row[];
  onDelete?: () => number[];
}) => {
  const rows = store.rows ?? [];
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: async () => rows,
    returning: async () => rows,
  };
  return {
    select: () => ({ from: () => query }),
    insert: () => ({
      values: (values: Row) => ({
        returning: async () => [store.onInsert!(values)],
      }),
    }),
    update: () => ({
      set: (values: Row) => ({
        where: () => ({
          returning: async () => [store.onUpdate!(values)],
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () =>
          store.onDelete!().map(id => ({ id: id as never })),
      }),
    }),
  };
};

const memoryRow = (overrides: Row = {}) => ({
  id: 7,
  ownerId: 1,
  chatId: 3,
  kind: "conversation",
  title: "Deploy the portfolio site",
  summary: "Built and deployed the portfolio site.",
  tags: null,
  content: "User: deploy the portfolio site\nNova: Live now.",
  s3Uri: null,
  createdAt: new Date("2026-09-20T10:00:00Z"),
  updatedAt: new Date("2026-09-21T10:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe("conversation memory store", () => {
  it("degrades gracefully when the database is unavailable", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(
      appendConversationTurn(1, 3, { userText: "hi", assistantText: "hello" })
    ).resolves.toBeNull();
    await expect(
      saveMemoryForUser(1, { title: "t", summary: "s", content: "c" })
    ).resolves.toBeNull();
    await expect(searchMemoriesForUser(1, "deploy")).resolves.toEqual([]);
    await expect(readMemoryForUser(1, 7)).resolves.toBeNull();
    await expect(deleteMemoryForUser(1, 7)).resolves.toBe(false);
    await expect(listRecentMemoriesForPrompt(1)).resolves.toBe("none yet");
  });

  it("never throws on a database failure while capturing a turn", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("neon down"));
    await expect(
      appendConversationTurn(1, 3, { userText: "hi", assistantText: "hello" })
    ).resolves.toBeNull();
  });

  it("saves an explicit memory and returns the record", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({
        onInsert: values =>
          memoryRow({ id: 42, chatId: null, kind: "note", ...values }),
      }) as never
    );
    const record = await saveMemoryForUser(1, {
      title: "Preferred stack",
      summary: "User prefers React.",
      content: "The user prefers React over Vue for new projects.",
      tags: "stack, react",
    });
    expect(record).toMatchObject({
      id: 42,
      kind: "note",
      title: "Preferred stack",
      tags: "stack, react",
    });
  });

  it("creates the chat memory on the first captured turn", async () => {
    const inserted = vi.fn((values: Row) =>
      memoryRow({ id: 9, ...values, updatedAt: new Date("2026-09-26T08:00:00Z") })
    );
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [], onInsert: inserted }) as never
    );
    const record = await appendConversationTurn(1, 3, {
      userText: "deploy the portfolio site",
      assistantText: "Live at https://example.netlify.app",
    });
    expect(record?.title).toBe("deploy the portfolio site");
    expect(record?.summary).toBe("Live at https://example.netlify.app");
    expect(record?.content).toBe(
      "User: deploy the portfolio site\nNova: Live at https://example.netlify.app"
    );
  });

  it("appends subsequent turns to the existing chat memory", async () => {
    const updated = vi.fn((values: Row) => memoryRow(values));
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [memoryRow()], onUpdate: updated }) as never
    );
    const record = await appendConversationTurn(1, 3, {
      userText: "add a contact page",
      assistantText: "Added it and redeployed.",
    });
    expect(updated).toHaveBeenCalled();
    // The prior transcript is kept and the new turn is joined on.
    const setContent = updated.mock.calls[0][0].content as string;
    expect(setContent).toContain("User: deploy the portfolio site");
    expect(setContent).toContain("---");
    expect(setContent).toContain("Nova: Added it and redeployed.");
    expect(record?.summary).toBe("Added it and redeployed.");
  });

  it("skips capture when both sides of the turn are empty", async () => {
    const db = makeFakeDb({} as never);
    vi.mocked(getDb).mockResolvedValue(db as never);
    await expect(
      appendConversationTurn(1, 3, { userText: "  ", assistantText: "" })
    ).resolves.toBeNull();
  });

  it("formats recent memories as compact prompt lines", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({
        rows: [
          memoryRow({ id: 9, updatedAt: new Date("2026-09-21T10:00:00Z") }),
        ],
      }) as never
    );
    const line = await listRecentMemoriesForPrompt(1);
    expect(line).toBe(
      "Deploy the portfolio site (memory id 9, updated 2026-09-21): Built and deployed the portfolio site."
    );
  });

  it("reads and deletes only for the owning user", async () => {
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ rows: [memoryRow()], onDelete: () => [7] }) as never
    );
    const record = await readMemoryForUser(1, 7);
    expect(record?.id).toBe(7);
    await expect(deleteMemoryForUser(1, 7)).resolves.toBe(true);
  });
});

describe("S3 mirror request signing", () => {
  const config = {
    bucket: "nova-memories",
    region: "us-east-1",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };
  const now = new Date("2026-09-27T12:00:00Z");

  it("builds a deterministic SigV4 PUT request", () => {
    const first = buildS3PutRequest(config, "memories/1/9.md", "# hello", now);
    const second = buildS3PutRequest(config, "memories/1/9.md", "# hello", now);
    expect(first).toEqual(second);
    expect(first.url).toBe(
      "https://nova-memories.s3.us-east-1.amazonaws.com/memories/1/9.md"
    );
    expect(first.headers["x-amz-date"]).toBe("20260927T120000Z");
    expect(first.headers["x-amz-content-sha256"]).toMatch(/^[a-f0-9]{64}$/);
    const signature = first.headers.Authorization.match(
      /Signature=([a-f0-9]{64})/
    )?.[1];
    expect(signature).toBeDefined();
    expect(first.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260927/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        `Signature=${signature}`
    );
    expect(first.headers.Host).toBe(
      "nova-memories.s3.us-east-1.amazonaws.com"
    );
  });

  it("changes the signature when the body changes", () => {
    const a = buildS3PutRequest(config, "memories/1/9.md", "# a", now);
    const b = buildS3PutRequest(config, "memories/1/9.md", "# b", now);
    const signatureOf = (request: { headers: Record<string, string> }) =>
      request.headers.Authorization.match(/Signature=([a-f0-9]{64})/)?.[1];
    expect(signatureOf(a)).not.toBe(signatureOf(b));
    expect(a.headers["x-amz-content-sha256"]).not.toBe(
      b.headers["x-amz-content-sha256"]
    );
  });
});
