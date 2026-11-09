-- Напарники: публичный профиль атлета, подписки и «Kudos» на тренировки.
-- Профиль закрыт по умолчанию: пока человек сам не откроет его, найти и увидеть его нельзя.
CREATE TABLE `athlete_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`tag` text NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`is_public` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_athlete_profiles_tag` ON `athlete_profiles` (`tag`);
--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`follower_id`, `followee_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_follows_followee` ON `follows` (`followee_id`);
--> statement-breakpoint
CREATE TABLE `kudos` (
	`workout_id` text NOT NULL,
	`giver_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workout_id`, `giver_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_kudos_workout` ON `kudos` (`workout_id`);
