CREATE TYPE "user_automation_frequency" AS ENUM ('hourly', 'daily', 'weekdays', 'weekly');--> statement-breakpoint
CREATE TABLE "user_automations" (
  "id" serial PRIMARY KEY NOT NULL,
  "ownerId" integer NOT NULL,
  "workspaceId" integer NOT NULL,
  "name" varchar(120) NOT NULL,
  "instructions" text NOT NULL,
  "frequency" "user_automation_frequency" DEFAULT 'daily' NOT NULL,
  "scheduleCron" varchar(64) NOT NULL,
  "scheduleCronTaskUid" varchar(65),
  "enabled" boolean DEFAULT false NOT NULL,
  "lastRunAt" timestamp with time zone,
  "lastError" varchar(1200),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_automations_scheduleCronTaskUid_unique" UNIQUE("scheduleCronTaskUid")
);--> statement-breakpoint
ALTER TABLE "user_automations" ADD CONSTRAINT "user_automations_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_automations" ADD CONSTRAINT "user_automations_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_automations_owner_idx" ON "user_automations" USING btree ("ownerId","createdAt");
