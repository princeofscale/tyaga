CREATE TABLE `friendships` (
	`low_id` text NOT NULL,
	`high_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`low_id`, `high_id`),
	FOREIGN KEY (`low_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`high_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sender_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_friendships_high` ON `friendships` (`high_id`);--> statement-breakpoint
CREATE TABLE `social_profiles` (
	`account_id` text PRIMARY KEY NOT NULL,
	`invite_code` text NOT NULL,
	`gym` text DEFAULT '' NOT NULL,
	`focus` text DEFAULT '' NOT NULL,
	`active_until` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_social_invite` ON `social_profiles` (`invite_code`);--> statement-breakpoint
CREATE TABLE `workout_kudos` (
	`workout_id` text NOT NULL,
	`account_id` text NOT NULL,
	PRIMARY KEY(`workout_id`, `account_id`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
