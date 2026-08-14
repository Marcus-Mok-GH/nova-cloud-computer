import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import {
  createProjectForUser,
  createTaskForUser,
  deleteProjectForUser,
  deleteTaskForUser,
  getProjectForUser,
  getDb,
  listTasksForUser,
  updateProjectForUser,
  updateTaskStatusForUser,
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
});
