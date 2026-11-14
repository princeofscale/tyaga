-- Local-only additive provenance/staging. No backfill: old revision-one imports are not trusted.
CREATE TABLE `workout_import_runs` (
  `owner_id` text NOT NULL,
  `run_id` text NOT NULL,
  `manifest_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `state` text NOT NULL DEFAULT 'staging',
  `workout_count` integer NOT NULL,
  `result` text NOT NULL,
  PRIMARY KEY (`owner_id`, `run_id`)
);
--> statement-breakpoint
CREATE TABLE `workout_import_receipts` (
  `owner_id` text NOT NULL,
  `workout_id` text NOT NULL,
  `run_id` text NOT NULL,
  `payload_hash` text NOT NULL,
  `payload` text NOT NULL,
  `date` text NOT NULL,
  `revision` integer NOT NULL,
  `action` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1,
  `previous_run_id` text,
  `previous_payload_hash` text,
  `previous_payload` text,
  `previous_date` text,
  `previous_revision` integer,
  PRIMARY KEY (`owner_id`, `workout_id`, `run_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workout_import_receipt_active` ON `workout_import_receipts` (`owner_id`, `workout_id`) WHERE `active`=1;
--> statement-breakpoint
CREATE INDEX `idx_import_receipts_run` ON `workout_import_receipts` (`owner_id`, `run_id`);
--> statement-breakpoint
CREATE TABLE `workout_import_staging` (
  `owner_id` text NOT NULL,
  `run_id` text NOT NULL,
  `workout_id` text NOT NULL,
  `payload` text NOT NULL,
  `payload_hash` text NOT NULL,
  `date` text NOT NULL,
  `action` text NOT NULL,
  `expected_revision` integer,
  `expected_payload` text,
  `previous_run_id` text,
  `previous_payload_hash` text,
  `previous_payload` text,
  `previous_date` text,
  `previous_revision` integer,
  PRIMARY KEY (`owner_id`, `run_id`, `workout_id`)
);
--> statement-breakpoint
CREATE TABLE `workout_import_dependencies` (
  `owner_id` text NOT NULL,
  `run_id` text NOT NULL,
  `kind` text NOT NULL,
  `id` text NOT NULL,
  `model_id` text,
  `payload` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `run_id`, `kind`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workout_import_finalize_requests` (
  `owner_id` text NOT NULL,
  `run_id` text NOT NULL,
  PRIMARY KEY (`owner_id`, `run_id`)
);
--> statement-breakpoint
CREATE TRIGGER `workout_import_finalize` AFTER INSERT ON `workout_import_finalize_requests` BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM workout_import_runs
    WHERE owner_id=NEW.owner_id AND run_id=NEW.run_id AND state='staging'
  ) THEN RAISE(ABORT, 'IMPORT_NOT_STAGING') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM workout_import_staging s
    WHERE s.owner_id=NEW.owner_id AND s.run_id=NEW.run_id) !=
    (SELECT workout_count FROM workout_import_runs WHERE owner_id=NEW.owner_id AND run_id=NEW.run_id)
    THEN RAISE(ABORT, 'IMPORT_INCOMPLETE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM workout_import_staging s
    WHERE s.owner_id=NEW.owner_id AND s.run_id=NEW.run_id AND (
      (s.action='added' AND EXISTS (
        SELECT 1 FROM workouts w WHERE w.owner_id=s.owner_id AND w.id=s.workout_id
      )) OR
      (s.action='replaced' AND NOT EXISTS (
        SELECT 1 FROM workouts w JOIN workout_import_receipts r
          ON r.owner_id=w.owner_id AND r.workout_id=w.id AND r.active=1
        WHERE w.owner_id=s.owner_id AND w.id=s.workout_id
          AND w.revision=s.expected_revision AND w.payload=s.expected_payload
          AND r.run_id=s.previous_run_id AND r.revision=s.expected_revision
          AND r.payload=s.expected_payload AND r.payload_hash=s.previous_payload_hash
      ))
    )
  ) THEN RAISE(ABORT, 'IMPORT_CAS') END;
  INSERT INTO machine_models(owner_id,id,payload)
  SELECT d.owner_id,d.id,d.payload FROM workout_import_dependencies d
  WHERE d.owner_id=NEW.owner_id AND d.run_id=NEW.run_id AND d.kind='machine_model'
  ON CONFLICT(owner_id,id) DO NOTHING;
  INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at)
  SELECT d.owner_id,d.id,d.model_id,d.payload,1,1,d.updated_at FROM workout_import_dependencies d
  WHERE d.owner_id=NEW.owner_id AND d.run_id=NEW.run_id AND d.kind='machine'
  ON CONFLICT(owner_id,id) DO NOTHING;
  INSERT INTO custom_exercises(id,owner_id,family_id,payload,active,updated_at)
  SELECT d.id,d.owner_id,json_extract(d.payload,'$.custom.familyId'),d.payload,1,d.updated_at
  FROM workout_import_dependencies d
  WHERE d.owner_id=NEW.owner_id AND d.run_id=NEW.run_id AND d.kind='custom_exercise'
  ON CONFLICT(id) DO UPDATE SET active=1
  WHERE custom_exercises.owner_id=excluded.owner_id;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM workout_import_dependencies d WHERE d.owner_id=NEW.owner_id AND d.run_id=NEW.run_id AND (
      (d.kind='machine_model' AND NOT EXISTS (SELECT 1 FROM machine_models x WHERE x.owner_id=d.owner_id AND x.id=d.id AND x.payload=d.payload)) OR
      (d.kind='machine' AND NOT EXISTS (SELECT 1 FROM machine_instances x WHERE x.owner_id=d.owner_id AND x.id=d.id AND x.active=1)) OR
      (d.kind='custom_exercise' AND NOT EXISTS (SELECT 1 FROM custom_exercises x WHERE x.owner_id=d.owner_id AND x.id=d.id AND x.active=1 AND x.payload=d.payload))
    )
  ) THEN RAISE(ABORT, 'IMPORT_DEPENDENCY') END;
  INSERT INTO workouts(id,owner_id,date,payload,updated_at,revision)
  SELECT s.workout_id,s.owner_id,s.date,s.payload,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         CASE WHEN s.action='added' THEN 1 ELSE s.expected_revision+1 END
  FROM workout_import_staging s
  WHERE s.owner_id=NEW.owner_id AND s.run_id=NEW.run_id AND 1
  ON CONFLICT(id) DO UPDATE SET
    date=excluded.date,payload=excluded.payload,updated_at=excluded.updated_at,
    revision=workouts.revision+1
  WHERE workouts.owner_id=excluded.owner_id;
  UPDATE workout_import_receipts SET active=0
  WHERE owner_id=NEW.owner_id AND active=1 AND EXISTS (
    SELECT 1 FROM workout_import_staging s
    WHERE s.owner_id=NEW.owner_id AND s.run_id=NEW.run_id
      AND s.action='replaced' AND s.workout_id=workout_import_receipts.workout_id
      AND s.previous_run_id=workout_import_receipts.run_id
  );
  INSERT INTO workout_import_receipts
    (owner_id,workout_id,run_id,payload_hash,payload,date,revision,action,active,
     previous_run_id,previous_payload_hash,previous_payload,previous_date,previous_revision)
  SELECT s.owner_id,s.workout_id,s.run_id,s.payload_hash,s.payload,s.date,
         CASE WHEN s.action='added' THEN 1 ELSE s.expected_revision+1 END,
         s.action,1,s.previous_run_id,s.previous_payload_hash,s.previous_payload,
         s.previous_date,s.previous_revision
  FROM workout_import_staging s
  WHERE s.owner_id=NEW.owner_id AND s.run_id=NEW.run_id;
  UPDATE workout_import_runs SET state='committed'
  WHERE owner_id=NEW.owner_id AND run_id=NEW.run_id AND state='staging';
END;
--> statement-breakpoint
CREATE TABLE `workout_sync_recovery` (
  `owner_id` text NOT NULL,
  `workout_id` text NOT NULL,
  `version_at` text NOT NULL,
  `date` text NOT NULL,
  `payload` text NOT NULL,
  `revision` integer NOT NULL,
  `received_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `workout_id`, `version_at`, `payload`)
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sync_recovery_owner` ON `workout_sync_recovery` (`owner_id`, `received_at`);
