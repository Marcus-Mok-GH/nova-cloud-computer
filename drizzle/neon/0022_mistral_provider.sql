-- Workspace rows that still point the renamed provider at NVIDIA catalog
-- model ids (they all contain a "/" or a kimi/nemotron family name) would fail
-- every request after the swap, so settle them on the new Mistral default.
UPDATE "workspace_settings" SET "activeModelId" = 'mistral-medium-3-5', "updatedAt" = now() WHERE "activeProvider" = 'nvidia-nim' AND ("activeModelId" LIKE '%/%' OR "activeModelId" LIKE '%kimi%' OR "activeModelId" LIKE '%nemotron%');--> statement-breakpoint
ALTER TABLE "nvidia_inference_allowances" RENAME TO "mistral_inference_allowances";--> statement-breakpoint
ALTER INDEX "nvidia_inference_allowances_workspace_unique" RENAME TO "mistral_inference_allowances_workspace_unique";--> statement-breakpoint
ALTER TYPE "model_provider" RENAME VALUE 'nvidia-nim' TO 'mistral';
