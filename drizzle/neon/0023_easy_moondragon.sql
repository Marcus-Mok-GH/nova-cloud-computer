ALTER TYPE "public"."site_deployment_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "mistral_inference_allowances" DROP CONSTRAINT "nvidia_inference_allowances_workspaceId_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "mistral_inference_allowances" ADD CONSTRAINT "mistral_inference_allowances_workspaceId_workspaces_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;