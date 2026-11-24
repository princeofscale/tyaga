ALTER TABLE `sessions` ADD COLUMN `id` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `user_agent` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `last_seen_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX `idx_sessions_id` ON `sessions` (`id`);
