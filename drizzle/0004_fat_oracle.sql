CREATE TABLE `custom_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`family_id` text NOT NULL,
	`payload` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_custom_owner_active` ON `custom_exercises` (`owner_id`,`active`);--> statement-breakpoint
CREATE TABLE `favorite_exercises` (
	`owner_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `exercise_id`)
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_routines_owner` ON `routines` (`owner_id`);