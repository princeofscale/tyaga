-- Hand-written (drizzle cannot model triggers). Every write to a synced table
-- leaves its document key and version time here; `seq` is the change cursor.
CREATE TABLE `sync_versions` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`doc_id` text NOT NULL,
	`version_at` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_versions_doc` ON `sync_versions` (`owner_id`,`kind`,`doc_id`);
--> statement-breakpoint
CREATE INDEX `idx_sync_versions_owner_seq` ON `sync_versions` (`owner_id`,`seq`);
--> statement-breakpoint
INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) SELECT `owner_id`,'workout',`id`,`updated_at` FROM `workouts`;
--> statement-breakpoint
INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) SELECT `owner_id`,'routine',`id`,`updated_at` FROM `routines`;
--> statement-breakpoint
INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) SELECT `owner_id`,'custom_exercise',`id`,`updated_at` FROM `custom_exercises`;
--> statement-breakpoint
INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) SELECT `owner_id`,'settings','settings','1970-01-01T00:00:00.000Z' FROM `settings`;
--> statement-breakpoint
INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) SELECT `owner_id`,'favorite',`exercise_id`,'1970-01-01T00:00:00.000Z' FROM `favorite_exercises`;
--> statement-breakpoint
CREATE TRIGGER `sync_workouts_insert` AFTER INSERT ON `workouts` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'workout' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'workout',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_workouts_update` AFTER UPDATE ON `workouts` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'workout' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'workout',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_workouts_delete` AFTER DELETE ON `workouts` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = OLD.`owner_id` AND `kind` = 'workout' AND `doc_id` = OLD.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`,`deleted`) VALUES (OLD.`owner_id`,'workout',OLD.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routines_insert` AFTER INSERT ON `routines` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'routine' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'routine',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routines_update` AFTER UPDATE ON `routines` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'routine' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'routine',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_routines_delete` AFTER DELETE ON `routines` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = OLD.`owner_id` AND `kind` = 'routine' AND `doc_id` = OLD.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`,`deleted`) VALUES (OLD.`owner_id`,'routine',OLD.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
END;
--> statement-breakpoint
CREATE TRIGGER `sync_custom_insert` AFTER INSERT ON `custom_exercises` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'custom_exercise' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'custom_exercise',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_custom_update` AFTER UPDATE ON `custom_exercises` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'custom_exercise' AND `doc_id` = NEW.`id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'custom_exercise',NEW.`id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_settings_insert` AFTER INSERT ON `settings` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'settings';
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'settings','settings',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_settings_update` AFTER UPDATE ON `settings` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'settings';
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'settings','settings',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_favorites_insert` AFTER INSERT ON `favorite_exercises` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = NEW.`owner_id` AND `kind` = 'favorite' AND `doc_id` = NEW.`exercise_id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`) VALUES (NEW.`owner_id`,'favorite',NEW.`exercise_id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
--> statement-breakpoint
CREATE TRIGGER `sync_favorites_delete` AFTER DELETE ON `favorite_exercises` BEGIN
	DELETE FROM `sync_versions` WHERE `owner_id` = OLD.`owner_id` AND `kind` = 'favorite' AND `doc_id` = OLD.`exercise_id`;
	INSERT INTO `sync_versions` (`owner_id`,`kind`,`doc_id`,`version_at`,`deleted`) VALUES (OLD.`owner_id`,'favorite',OLD.`exercise_id`,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
END;
