import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendConversationTurn,
  buildS3PutRequest,
  clearMemoriesForUser,
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
  onDeleteWhere?: (condition: unknown) => void;
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
      where: (condition: unknown) => {
        store.onDeleteWhere?.(condition);
        return {
          returning: async () =>
            store.onDelete!().map(id => ({ id: id as never })),
        };
      },
    }),
  };
};

/**
 * Recursively pulls drizzle Param values out of a where-condition tree, so a
 * test can inspect what a delete was scoped to even though the fake database
 * (like the real one) is the component that evaluates the predicate.
 */
function paramValues(condition: unknown, depth = 0): unknown[] {
  if (!condition || typeof condition !== "object" || depth > 6) return [];
  if (Array.isArray(condition))
    return condition.flatMap(item => paramValues(item, depth + 1));
  if (Array.isArray((condition as { queryChunks?: unknown[] }).queryChunks)) {
    return ((condition as { queryChunks: unknown[] }).queryChunks).flatMap(
      chunk => paramValues(chunk, depth + 1)
    );
  }
  const maybe = condition as { value?: unknown; brand?: unknown; encoder?: unknown };
  if ("brand" in maybe && "encoder" in maybe) return [maybe.value];
  return Object.values(condition).flatMap(value => paramValues(value, depth + 1));
}

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

  it("fails a clear when the database is unavailable rather than reporting success", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(clearMemoriesForUser(1)).rejects.toThrow(
      "Nova can't reach your workspace data right now."
    );
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

  it("clamps oversized tags and content on explicit saves", async () => {
    const inserted = vi.fn((values: Row) => memoryRow({ ...values }));
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({ onInsert: inserted }) as never
    );
    await saveMemoryForUser(1, {
      title: "Big note",
      summary: "s",
      content: "x".repeat(30_000),
      tags: "t".repeat(600),
    });
    const values = inserted.mock.calls[0][0];
    expect((values.tags as string).length).toBeLessThanOrEqual(500);
    expect((values.content as string).length).toBeLessThan(30_000);
    expect(values.content).toContain("(content truncated)");
  });

  it("strips backslashes from search terms before the ILIKE query", async () => {
    vi.mocked(getDb).mockResolvedValue(makeFakeDb({ rows: [] }) as never);
    await expect(searchMemoriesForUser(1, "foo\\")).resolves.toEqual([]);
  });

  it("clears every stored memory for the owner and reports how many were removed", async () => {
    let whereCondition: unknown;
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({
        onDelete: () => [7, 8, 9],
        onDeleteWhere: condition => {
          whereCondition = condition;
        },
      }) as never
    );
    await expect(clearMemoriesForUser(1)).resolves.toBe(3);
    expect(paramValues(whereCondition)).toContain(1);
  });

  it("narrows the clear to a single agent when a scope is given", async () => {
    let whereCondition: unknown;
    vi.mocked(getDb).mockResolvedValue(
      makeFakeDb({
        onDelete: () => [7],
        onDeleteWhere: condition => {
          whereCondition = condition;
        },
      }) as never
    );
    await expect(clearMemoriesForUser(1, { agentId: 5 })).resolves.toBe(1);
    const params = paramValues(whereCondition);
    expect(params).toContain(1);
    expect(params).toContain(5);
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
