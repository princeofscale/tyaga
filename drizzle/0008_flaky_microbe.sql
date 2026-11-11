CREATE TABLE `bodyweight_documents` (
	`owner_id` text NOT NULL,
	`doc_key` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`mutation_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner_id`, `doc_key`)
);
--> statement-breakpoint
CREATE TABLE `meetup_participants` (
	`meetup_id` text NOT NULL,
	`account_id` text NOT NULL,
	`response` text NOT NULL,
	`gym` text DEFAULT '' NOT NULL,
	`workout_id` text,
	PRIMARY KEY(`meetup_id`, `account_id`),
	FOREIGN KEY (`meetup_id`) REFERENCES `training_meetups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meetup_participant` ON `meetup_participants` (`account_id`,`meetup_id`);--> statement-breakpoint
CREATE TABLE `training_meetups` (
	`id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`name` text NOT NULL,
	`starts_at` text NOT NULL,
	`gym` text NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_meetups_host_start` ON `training_meetups` (`host_id`,`starts_at`);--> statement-breakpoint
ALTER TABLE `social_profiles` ADD `weekly_target` integer DEFAULT 3 NOT NULL;