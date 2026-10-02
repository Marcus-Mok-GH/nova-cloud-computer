CREATE TYPE "public"."inference_queue_status" AS ENUM('waiting', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "inference_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"channel" varchar(32) NOT NULL,
	"status" "inference_queue_status" DEFAULT 'waiting' NOT NULL,
	"chatId" varchar(24),
	"content" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"errorMessage" varchar(1200),
	"startedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inference_queue" ADD CONSTRAINT "inference_queue_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_queue" ADD CONSTRAINT "inference_queue_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inference_queue_status_id_idx" ON "inference_queue" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "inference_queue_owner_status_idx" ON "inference_queue" USING btree ("ownerId","status");