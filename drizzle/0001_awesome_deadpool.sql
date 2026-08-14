CREATE TABLE `custom_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`modelId` varchar(240) NOT NULL,
	`baseUrl` varchar(2048) NOT NULL,
	`compatibility` enum('openai','anthropic') NOT NULL,
	`encryptedApiKey` text NOT NULL,
	`supportsImageInput` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_models_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_models_workspace_name_unique` UNIQUE(`workspaceId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`activeProvider` enum('anthropic','openai','gemini','custom') NOT NULL DEFAULT 'anthropic',
	`activeModelId` varchar(240) NOT NULL DEFAULT 'claude-sonnet',
	`activeCustomModelId` int,
	`workspaceRules` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspace_settings_workspace_unique` UNIQUE(`workspaceId`)
);
--> statement-breakpoint
ALTER TABLE `custom_models` ADD CONSTRAINT `custom_models_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_settings` ADD CONSTRAINT `workspace_settings_workspaceId_workspaces_id_fk` FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workspace_settings` ADD CONSTRAINT `workspace_settings_activeCustomModelId_custom_models_id_fk` FOREIGN KEY (`activeCustomModelId`) REFERENCES `custom_models`(`id`) ON DELETE set null ON UPDATE no action;