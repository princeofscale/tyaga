CREATE TABLE `live_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`account_id` text NOT NULL,
	`state` text,
	`joined_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_live_members_account` ON `live_members` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_live_members_code` ON `live_members` (`code`);