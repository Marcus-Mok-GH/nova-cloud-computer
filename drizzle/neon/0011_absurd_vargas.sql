ALTER TYPE "public"."model_provider" ADD VALUE 'nvidia-nim';--> statement-breakpoint
CREATE TABLE "domain_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" varchar(256) NOT NULL,
	"verificationToken" varchar(256) NOT NULL,
	"dnsRecordName" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"checkedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "persistentSandboxId" varchar(256);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "persistentSandboxId" varchar(256);--> statement-breakpoint
CREATE UNIQUE INDEX "domain_verifications_domain_unique" ON "domain_verifications" USING btree ("domain");