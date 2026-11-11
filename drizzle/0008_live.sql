-- Совместные тренировки: комната живёт, пока в ней кто-то отвечает; один человек — одна комната.
-- Состояние участника — короткий JSON с итогами подходов, без заметок и истории.
CREATE TABLE `live_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`owner_id` text NOT NULL,
	`state` text,
	`joined_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_live_members_owner` ON `live_members` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `idx_live_members_code` ON `live_members` (`code`);
