CREATE TABLE "conversation_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" integer NOT NULL,
	"chatId" integer,
	"kind" varchar(32) DEFAULT 'conversation' NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" text NOT NULL,
	"tags" varchar(500),
	"content" text NOT NULL,
	"s3Uri" varchar(500),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_memories" ADD CONSTRAINT "conversation_memories_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_memories" ADD CONSTRAINT "conversation_memories_chatId_chats_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_memories_owner_updated_idx" ON "conversation_memories" USING btree ("ownerId","updatedAt");