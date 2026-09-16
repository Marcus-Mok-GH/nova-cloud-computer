CREATE TABLE IF NOT EXISTS "agent_stop_requests" (
    "id" serial PRIMARY KEY,
    "ownerId" integer NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_stop_requests_owner_idx" ON "agent_stop_requests" ("ownerId", "createdAt");
