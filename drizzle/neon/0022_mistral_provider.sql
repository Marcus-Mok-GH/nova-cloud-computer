ALTER TABLE "nvidia_inference_allowances" RENAME TO "mistral_inference_allowances";--> statement-breakpoint
ALTER INDEX "nvidia_inference_allowances_workspace_unique" RENAME TO "mistral_inference_allowances_workspace_unique";--> statement-breakpoint
ALTER TYPE "model_provider" RENAME VALUE 'nvidia-nim' TO 'mistral';
