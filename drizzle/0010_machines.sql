CREATE TABLE `machine_instances` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`model_id` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_machines_owner` ON `machine_instances` (`owner_id`,`active`);--> statement-breakpoint
CREATE TABLE `machine_models` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`)
);

--> statement-breakpoint
CREATE TRIGGER sync_machine_models_insert AFTER INSERT ON machine_models BEGIN
 DELETE FROM sync_versions WHERE owner_id=NEW.owner_id AND kind='machine_model' AND doc_id=NEW.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (NEW.owner_id,'machine_model',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0);
END;
--> statement-breakpoint
CREATE TRIGGER sync_machine_models_update AFTER UPDATE ON machine_models BEGIN
 DELETE FROM sync_versions WHERE owner_id=NEW.owner_id AND kind='machine_model' AND doc_id=NEW.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (NEW.owner_id,'machine_model',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0);
END;
--> statement-breakpoint
CREATE TRIGGER sync_machine_models_delete AFTER DELETE ON machine_models BEGIN
 DELETE FROM sync_versions WHERE owner_id=OLD.owner_id AND kind='machine_model' AND doc_id=OLD.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (OLD.owner_id,'machine_model',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
END;
--> statement-breakpoint
CREATE TRIGGER sync_machine_instances_insert AFTER INSERT ON machine_instances BEGIN
 DELETE FROM sync_versions WHERE owner_id=NEW.owner_id AND kind='machine' AND doc_id=NEW.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (NEW.owner_id,'machine',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0);
END;
--> statement-breakpoint
CREATE TRIGGER sync_machine_instances_update AFTER UPDATE ON machine_instances BEGIN
 DELETE FROM sync_versions WHERE owner_id=NEW.owner_id AND kind='machine' AND doc_id=NEW.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (NEW.owner_id,'machine',NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0);
END;
--> statement-breakpoint
CREATE TRIGGER sync_machine_instances_delete AFTER DELETE ON machine_instances BEGIN
 DELETE FROM sync_versions WHERE owner_id=OLD.owner_id AND kind='machine' AND doc_id=OLD.id;
 INSERT INTO sync_versions(owner_id,kind,doc_id,version_at,deleted) VALUES (OLD.owner_id,'machine',OLD.id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),1);
END;
