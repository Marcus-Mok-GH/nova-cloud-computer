ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "snapshotId" varchar(256);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "fileRevision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "snapshotRevision" integer;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "bumpWorkspaceFileRevision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "workspaces"
    SET "fileRevision" = "fileRevision" + 1
    WHERE "id" = OLD."workspaceId";
    RETURN OLD;
  END IF;

  UPDATE "workspaces"
  SET "fileRevision" = "fileRevision" + 1
  WHERE "id" = NEW."workspaceId";
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS "workspace_files_revision" ON "workspace_files"';
  EXECUTE 'CREATE TRIGGER "workspace_files_revision" AFTER INSERT OR UPDATE OR DELETE ON "workspace_files" FOR EACH ROW EXECUTE FUNCTION "bumpWorkspaceFileRevision"()';
  EXECUTE 'DROP TRIGGER IF EXISTS "workspace_folders_revision" ON "workspace_folders"';
  EXECUTE 'CREATE TRIGGER "workspace_folders_revision" AFTER INSERT OR UPDATE OR DELETE ON "workspace_folders" FOR EACH ROW EXECUTE FUNCTION "bumpWorkspaceFileRevision"()';
END;
$$;
