CREATE TABLE `catalog_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`record_count` integer NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` integer NOT NULL,
	`release` text NOT NULL,
	`name` text NOT NULL,
	`search_text` text NOT NULL,
	`zones` text NOT NULL,
	`equipment` text NOT NULL,
	`language` text NOT NULL,
	`loggable` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exercise_catalog_release_name` ON `exercise_catalog` (`release`,`name`);