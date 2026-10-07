CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`time_zone` text NOT NULL,
	`body_mass_kg` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_platform` ON `accounts` (`platform_id`);--> statement-breakpoint
CREATE TABLE `auth_limits` (
	`platform_id` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_account_expiry` ON `sessions` (`account_id`,`expires_at`);