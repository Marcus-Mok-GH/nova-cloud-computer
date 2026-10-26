ALTER TABLE "workspaces" ADD COLUMN "snapshotId" varchar(256);--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "fileRevision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "snapshotRevision" integer;--> statement-breakpoint

CREATE FUNCTION "bumpWorkspaceFileRevision"() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER "workspace_files_revision"
AFTER INSERT OR UPDATE OR DELETE ON "workspace_files"
FOR EACH ROW EXECUTE FUNCTION "bumpWorkspaceFileRevision"();
--> statement-breakpoint

CREATE TRIGGER "workspace_folders_revision"
AFTER INSERT OR UPDATE OR DELETE ON "workspace_folders"
FOR EACH ROW EXECUTE FUNCTION "bumpWorkspaceFileRevision"();
