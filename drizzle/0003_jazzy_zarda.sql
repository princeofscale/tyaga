CREATE TABLE `catalog_memberships` (
	`release` text NOT NULL,
	`exercise_id` text NOT NULL,
	PRIMARY KEY(`release`, `exercise_id`)
);
