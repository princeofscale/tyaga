CREATE TABLE `challenge_participants` (
	`challenge_id` text NOT NULL,
	`account_id` text NOT NULL,
	`response` text NOT NULL,
	`target` integer NOT NULL,
	`joined_at` text,
	PRIMARY KEY(`challenge_id`, `account_id`),
	FOREIGN KEY (`challenge_id`) REFERENCES `team_challenges`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_challenge_participant` ON `challenge_participants` (`account_id`,`challenge_id`);--> statement-breakpoint
CREATE TABLE `team_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_challenge_host_start` ON `team_challenges` (`host_id`,`start_date`);