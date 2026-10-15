import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// The typed failures the router maps to TRPC codes. They are defined here (not
// imported) because the module itself is mocked: instanceof must compare
// against the very class the mocked store throws. The name-taken message
// mirrors the real one so the router's conflict mapping is asserted end to end.
const mocks = vi.hoisted(() => {
  class SkillNameTakenError extends Error {
    constructor(name: string) {
      super(`A skill named "${name}" already exists - pick a different name.`);
    }
  }
  class SkillStorageError extends Error {}
  return { SkillNameTakenError, SkillStorageError };
});

type SkillRecord = {
  id: number;
  ownerId: number;
  name: string;
  description: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

const skills = new Map<number, SkillRecord>();
let nextSkillId = 500;

const { SkillNameTakenError, SkillStorageError } = mocks;

const listSkills = vi.fn(async (ownerId: number) =>
  [...skills.values()].filter(skill => skill.ownerId === ownerId)
);
const createSkill = vi.fn(
  async (
    ownerId: number,
    input: { name: string; description: string; body?: string }
  ) => {
    const name = input.name.trim().toLowerCase();
    if (
      [...skills.values()].some(
        skill => skill.ownerId === ownerId && skill.name === name
      )
    )
      throw new SkillNameTakenError(name);
    const skill: SkillRecord = {
      id: nextSkillId++,
      ownerId,
      name,
      description: input.description.trim(),
      body: input.body ?? "",
      createdAt: new Date("2026-10-15T09:00:00Z"),
      updatedAt: new Date("2026-10-15T09:00:00Z"),
    };
    skills.set(skill.id, skill);
    return skill;
  }
);
const updateSkill = vi.fn(
  async (
    ownerId: number,
    skillId: number,
    input: { name?: string; description?: string; body?: string }
  ) => {
    const skill = skills.get(skillId);
    if (!skill || skill.ownerId !== ownerId) return null;
    const name =
      input.name === undefined ? skill.name : input.name.trim().toLowerCase();
    if (
      [...skills.values()].some(
        other =>
          other.id !== skill.id &&
          other.ownerId === ownerId &&
          other.name === name
      )
    )
      throw new SkillNameTakenError(name);
    const updated: SkillRecord = {
      ...skill,
      name,
      description: input.description ?? skill.description,
      body: input.body ?? skill.body,
      updatedAt: new Date("2026-10-16T09:00:00Z"),
    };
    skills.set(skill.id, updated);
    return updated;
  }
);
const deleteSkill = vi.fn(async (ownerId: number, skillId: number) => {
  const skill = skills.get(skillId);
  if (!skill || skill.ownerId !== ownerId) return false;
  skills.delete(skillId);
  return true;
});

vi.mock("./skills", () => ({
  SkillNameTakenError: mocks.SkillNameTakenError,
  SkillStorageError: mocks.SkillStorageError,
  listSkillsForUser: listSkills,
  createSkillForUser: createSkill,
  updateSkillForUser: updateSkill,
  deleteSkillForUser: deleteSkill,
}));

// The router's skill procedures reach the store only through ./skills, so the
// database mock here only has to satisfy the module graph at import time.
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getDailyCreditStatusForUser: vi.fn(async () => ({
    region: "global",
    creditDay: "2026-10-15",
    dailyCredits: 500,
    usedCredits: 0,
    remainingCredits: 500,
    creditValueCents: 1,
  })),
  getActiveCustomModelForUser: vi.fn(async () => null),
}));
vi.mock("./aiGateway", () => ({
  listGatewayModels: vi.fn(async () => []),
  getAiGatewayStatus: vi.fn(async () => ({
    configured: false,
    reachable: false,
  })),
  completeWithAiGateway: vi.fn(async () => ({
    text: "",
    model: "nova-pro",
    usage: null,
  })),
  chatWithAiGateway: vi.fn(async () => ({ text: "", toolCalls: [] })),
  AiGatewayClientError: class AiGatewayClientError extends Error {},
}));

const { appRouter } = await import("./routers");

function contextFor(id: number): TrpcContext {
  return {
    user: {
      id,
      openId: `user-${id}`,
      name: `User ${id}`,
      email: null,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const validSkill = {
  name: "weekly-report",
  description:
    "Writes the weekly status report. Use when the user asks for the weekly update.",
  body: "1. Read the shipped changes.\n2. Summarize in five bullets.",
};

describe("skills authenticated API", () => {
  beforeEach(() => {
    skills.clear();
    nextSkillId = 500;
    vi.clearAllMocks();
  });

  it("creates, lists, updates, and deletes a skill through the authenticated router", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    const skill = await caller.skills.create(validSkill);
    expect(skill).toMatchObject({
      id: 500,
      name: "weekly-report",
      ownerId: 41,
    });
    expect(await caller.skills.list()).toHaveLength(1);

    const updated = await caller.skills.update({
      id: skill.id,
      description: "Writes the weekly status report. Use on Friday afternoons.",
    });
    expect(updated).toMatchObject({
      name: "weekly-report",
      body: validSkill.body,
    });

    await expect(caller.skills.delete({ id: skill.id })).resolves.toEqual({
      success: true,
    });
    expect(await caller.skills.list()).toEqual([]);
    await expect(caller.skills.delete({ id: skill.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects anything the Agent Skills format does not allow", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    await expect(
      caller.skills.create({ ...validSkill, name: "Weekly Report" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/lowercase/),
    });
    await expect(
      caller.skills.create({ ...validSkill, description: "  " })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.skills.create({ ...validSkill, body: " " })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/instructions/i),
    });
    await expect(
      caller.skills.create({ ...validSkill, name: `${validSkill.name}-` })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.skills.list()).resolves.toEqual([]);
  });

  it("surfaces a duplicate skill name as a conflict", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    await caller.skills.create(validSkill);
    await expect(caller.skills.create(validSkill)).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringMatching(/already exists/),
    });
  });

  it("requires at least one field on an update", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    const skill = await caller.skills.create(validSkill);
    await expect(caller.skills.update({ id: skill.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("keeps one user's skills invisible and untouchable to another", async () => {
    const owner = appRouter.createCaller(contextFor(41));
    const stranger = appRouter.createCaller(contextFor(82));
    const skill = await owner.skills.create(validSkill);

    expect(await stranger.skills.list()).toEqual([]);
    await expect(
      stranger.skills.update({ id: skill.id, body: "overwritten" })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      stranger.skills.delete({ id: skill.id })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await owner.skills.list()).toEqual([
      expect.objectContaining({ body: validSkill.body }),
    ]);
  });

  it("turns an unreachable store into a precondition instead of a silent failure", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    const original = createSkill.getMockImplementation()!;
    createSkill.mockImplementationOnce(async () => {
      throw new SkillStorageError();
    });
    await expect(caller.skills.create(validSkill)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    createSkill.mockImplementation(original);
  });
});
