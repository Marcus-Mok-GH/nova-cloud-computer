CREATE TABLE IF NOT EXISTS "nvidia_inference_allowances" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspaceId" integer NOT NULL,
	"usedRequests" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "nvidia_inference_allowances" ADD CONSTRAINT "nvidia_inference_allowances_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nvidia_inference_allowances_workspace_unique" ON "nvidia_inference_allowances" USING btree ("workspaceId");
