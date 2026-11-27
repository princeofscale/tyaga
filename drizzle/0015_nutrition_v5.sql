-- Migration: 0015_nutrition_v5.sql
-- Tyaga v5 AdaptiveNutritionEngine schema for Cloudflare D1 (SQLite)
-- Export-safe: strictly standard tables & B-Tree indexes, ZERO virtual/FTS5 tables.

CREATE TABLE IF NOT EXISTS nutrition_profiles (
  user_id                  TEXT PRIMARY KEY,
  sex                      TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  age_years                INTEGER NOT NULL CHECK (age_years BETWEEN 14 AND 100),
  height_cm                REAL NOT NULL CHECK (height_cm BETWEEN 120.0 AND 240.0),
  baseline_weight_kg       REAL NOT NULL CHECK (baseline_weight_kg BETWEEN 30.0 AND 300.0),
  body_fat_pct             REAL CHECK (body_fat_pct IS NULL OR (body_fat_pct BETWEEN 4.0 AND 55.0)),
  ffm_formula              TEXT NOT NULL DEFAULT 'janmahasatian'
                           CHECK (ffm_formula IN ('janmahasatian', 'boer')),
  neat_level               TEXT NOT NULL DEFAULT 'moderate'
                           CHECK (neat_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
  weekly_training_sessions REAL NOT NULL DEFAULT 5.25
                           CHECK (weekly_training_sessions BETWEEN 0.0 AND 14.0),
  training_level           TEXT NOT NULL DEFAULT 'intermediate'
                           CHECK (training_level IN ('novice', 'intermediate', 'advanced')),
  long_levers              INTEGER NOT NULL DEFAULT 0 CHECK (long_levers IN (0, 1)),
  goal_mode                TEXT NOT NULL DEFAULT 'maintenance'
                           CHECK (goal_mode IN ('lean_bulk', 'recomp', 'maintenance', 'mini_cut', 'cut')),
  phase_started_date       TEXT NOT NULL,          -- ISO YYYY-MM-DD
  creatine_start_date      TEXT,                   -- ISO YYYY-MM-DD or NULL
  carb_cycling_enabled     INTEGER NOT NULL DEFAULT 1 CHECK (carb_cycling_enabled IN (0, 1)),
  current_target_kcal      REAL CHECK (current_target_kcal IS NULL OR (current_target_kcal BETWEEN 1000.0 AND 7000.0)),
  last_energy_status       TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (last_energy_status IN ('deficit', 'maintenance', 'optimal_surplus', 'high_surplus', 'unknown')),
  created_at               INTEGER NOT NULL,       -- Unix epoch ms
  updated_at               INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bodyweight_logs (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  log_date                 TEXT NOT NULL,          -- ISO YYYY-MM-DD
  weight_kg                REAL NOT NULL CHECK (weight_kg BETWEEN 25.0 AND 350.0),
  scale_trend_kg           REAL,
  metabolic_trend_kg       REAL,
  creatine_offset_kg       REAL NOT NULL DEFAULT 0.0 CHECK (creatine_offset_kg >= 0.0),
  is_outlier               INTEGER NOT NULL DEFAULT 0 CHECK (is_outlier IN (0, 1)),
  source                   TEXT NOT NULL DEFAULT 'manual'
                           CHECK (source IN ('manual', 'smart_scale', 'apple_health', 'health_connect')),
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  UNIQUE (user_id, log_date),
  FOREIGN KEY (user_id) REFERENCES nutrition_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bodyweight_logs_user_date
  ON bodyweight_logs (user_id, log_date DESC);

CREATE TABLE IF NOT EXISTS daily_nutrition_logs (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  log_date                 TEXT NOT NULL,          -- ISO YYYY-MM-DD
  calories_kcal            REAL NOT NULL CHECK (calories_kcal >= 0.0 AND calories_kcal <= 15000.0),
  protein_g                REAL CHECK (protein_g IS NULL OR protein_g >= 0.0),
  fat_g                    REAL CHECK (fat_g IS NULL OR fat_g >= 0.0),
  carbs_g                  REAL CHECK (carbs_g IS NULL OR carbs_g >= 0.0),
  day_type                 TEXT NOT NULL DEFAULT 'push'
                           CHECK (day_type IN ('legs', 'push', 'pull', 'rest', 'deload')),
  partial_log              INTEGER NOT NULL DEFAULT 0 CHECK (partial_log IN (0, 1)),
  notes                    TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL,
  UNIQUE (user_id, log_date),
  FOREIGN KEY (user_id) REFERENCES nutrition_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_daily_nutrition_logs_user_date
  ON daily_nutrition_logs (user_id, log_date DESC);

CREATE TABLE IF NOT EXISTS nutrition_checkins (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  checkin_date             TEXT NOT NULL,          -- ISO YYYY-MM-DD
  engine_mode              TEXT NOT NULL CHECK (engine_mode IN ('pro', 'lite')),
  tdee_status              TEXT NOT NULL,
  goal_mode                TEXT NOT NULL CHECK (goal_mode IN ('lean_bulk', 'recomp', 'maintenance', 'mini_cut', 'cut')),
  prior_tdee_kcal          REAL NOT NULL,
  adaptive_tdee_kcal       REAL NOT NULL,
  uncertainty_sd_kcal      REAL,
  confidence               REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  trend_weight_kg          REAL NOT NULL,
  rate_pct_per_week        REAL NOT NULL,
  next_target_kcal         REAL,                   -- NULL in Lite mode
  kcal_delta_hint          REAL,                   -- Populated in Lite mode
  safety_floor_kcal        REAL NOT NULL,
  safety_floor_hit         INTEGER NOT NULL DEFAULT 0 CHECK (safety_floor_hit IN (0, 1)),
  achieved_ea_kcal_kg_ffm  REAL,
  neat_plateau_detected    INTEGER NOT NULL DEFAULT 0 CHECK (neat_plateau_detected IN (0, 1)),
  diet_break_recommended   INTEGER NOT NULL DEFAULT 0 CHECK (diet_break_recommended IN (0, 1)),
  diet_break_reason        TEXT,
  energy_status            TEXT NOT NULL
                           CHECK (energy_status IN ('deficit', 'maintenance', 'optimal_surplus', 'high_surplus', 'unknown')),
  capacity_multiplier      REAL NOT NULL CHECK (capacity_multiplier BETWEEN 0.70 AND 1.25),
  adjustment_reason        TEXT NOT NULL,
  created_at               INTEGER NOT NULL,
  UNIQUE (user_id, checkin_date),
  FOREIGN KEY (user_id) REFERENCES nutrition_profiles(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nutrition_checkins_user_date
  ON nutrition_checkins (user_id, checkin_date DESC);
