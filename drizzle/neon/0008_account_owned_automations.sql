DROP INDEX "automations_enabled_idx";--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "ownerId" integer;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "scheduleCronTaskUid" varchar(65);--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "ownerId" integer;--> statement-breakpoint
UPDATE "automations"
SET "ownerId" = "workspaces"."ownerId"
FROM "workspaces"
WHERE "automations"."workspaceId" = "workspaces"."id";--> statement-breakpoint
UPDATE "automation_runs"
SET "ownerId" = "automations"."ownerId"
FROM "automations"
WHERE "automation_runs"."automationId" = "automations"."id";--> statement-breakpoint
ALTER TABLE "automations" ALTER COLUMN "ownerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "ownerId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_owner_enabled_idx" ON "automations" USING btree ("ownerId","enabled");--> statement-breakpoint
CREATE INDEX "automation_runs_owner_created_idx" ON "automation_runs" USING btree ("ownerId","createdAt");--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_scheduleCronTaskUid_unique" UNIQUE("scheduleCronTaskUid");
