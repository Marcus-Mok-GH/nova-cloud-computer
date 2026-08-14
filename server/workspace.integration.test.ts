import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { customModels, users } from "../drizzle/schema";
import {
  createCustomModelForUser,
  createProjectForUser,
  createTaskForUser,
  deleteProjectForUser,
  deleteTaskForUser,
  deleteCustomModelForUser,
  getProjectForUser,
  getDb,
  getWorkspaceModelSettingsForUser,
  listTasksForUser,
  updateProjectForUser,
  updateTaskStatusForUser,
  updateWorkspaceModelSettingsForUser,
} from "./db";

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === "1";
const databaseIt = runDatabaseIntegration ? it : it.skip;

describe("Nova workspace persistence", () => {
  databaseIt("creates, reads, updates, and removes private project data against the configured database", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database integration requested without a database connection.");
    const owner = (await db.select().from(users).limit(1))[0];
    if (!owner) throw new Error("Database integration requested before an authenticated user exists.");

    const marker = `Nova verification ${Date.now()}`;
    let projectId: number | undefined;
    let taskId: number | undefined;
    try {
      const project = await createProjectForUser(owner.id, { name: marker, description: "Temporary backend verification record." });
      expect(project?.id).toBeTypeOf("number");
      projectId = project?.id;
      expect(await getProjectForUser(owner.id, projectId!)).toMatchObject({ id: projectId, name: marker });
      expect(await updateProjectForUser(owner.id, projectId!, { name: `${marker} updated` })).toMatchObject({ id: projectId, name: `${marker} updated` });

      const task = await createTaskForUser(owner.id, { projectId: projectId!, title: `${marker} task` });
      expect(task?.id).toBeTypeOf("number");
      taskId = task?.id;
      expect((await listTasksForUser(owner.id)).some(item => item.id === taskId)).toBe(true);

      expect(await updateTaskStatusForUser(owner.id, taskId!, "done")).toMatchObject({ id: taskId, status: "done" });
      expect(await deleteTaskForUser(owner.id, taskId!)).toBe(true);
      expect((await listTasksForUser(owner.id)).some(item => item.id === taskId)).toBe(false);
    } finally {
      if (projectId) await deleteProjectForUser(owner.id, projectId);
      if (projectId) expect(await db.select().from(users).where(eq(users.id, owner.id)).limit(1)).toHaveLength(1);
    }
  }, 30_000);

  databaseIt("encrypts custom endpoint credentials at rest and returns safe workspace settings", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database integration requested without a database connection.");
    const owner = (await db.select().from(users).limit(1))[0];
    if (!owner) throw new Error("Database integration requested before an authenticated user exists.");

    const marker = `Private endpoint ${Date.now()}`;
    const apiKey = "test-key-that-must-not-be-plain";
    let customModelId: number | undefined;
    try {
      const model = await createCustomModelForUser(owner.id, { name: marker, modelId: "test-model", baseUrl: "https://models.example.test/v1", compatibility: "openai", apiKey, supportsImageInput: true });
      customModelId = model.id;
      expect(JSON.stringify(model)).not.toContain(apiKey);
      const raw = (await db.select().from(customModels).where(eq(customModels.id, model.id)).limit(1))[0];
      expect(raw?.encryptedApiKey).toBeTruthy();
      expect(raw?.encryptedApiKey).not.toContain(apiKey);

      const settings = await updateWorkspaceModelSettingsForUser(owner.id, { activeProvider: "custom", activeCustomModelId: model.id });
      expect(settings).toMatchObject({ activeProvider: "custom", activeCustomModelId: model.id });
      const safeSettings = await getWorkspaceModelSettingsForUser(owner.id);
      expect(JSON.stringify(safeSettings)).not.toContain(apiKey);
      expect(safeSettings.customModels).toEqual(expect.arrayContaining([expect.objectContaining({ id: model.id, name: marker, hasApiKey: true })]));
    } finally {
      if (customModelId) await deleteCustomModelForUser(owner.id, customModelId);
    }
  }, 30_000);
});
