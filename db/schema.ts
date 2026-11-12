import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    date: text("date").notNull(),
    payload: text("payload").notNull(),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(0),
  },
  (table) => [index("idx_workouts_owner_date").on(table.ownerId, table.date)],
);

export const settings = sqliteTable("settings", {
  ownerId: text("owner_id").primaryKey(),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(0),
});

export const exerciseCatalog = sqliteTable(
  "exercise_catalog",
  {
    id: text("id").primaryKey(),
    sourceId: integer("source_id").notNull(),
    release: text("release").notNull(),
    name: text("name").notNull(),
    searchText: text("search_text").notNull(),
    zones: text("zones").notNull(),
    equipment: text("equipment").notNull(),
    language: text("language").notNull(),
    loggable: integer("loggable").notNull(),
    payload: text("payload").notNull(),
  },
  (table) => [
    index("idx_exercise_catalog_release_name").on(table.release, table.name),
  ],
);

export const catalogReleases = sqliteTable("catalog_releases", {
  id: text("id").primaryKey(),
  recordCount: integer("record_count").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const catalogMemberships = sqliteTable(
  "catalog_memberships",
  {
    release: text("release").notNull(),
    exerciseId: text("exercise_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.release, table.exerciseId] })],
);

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_routines_owner").on(table.ownerId)],
);

export const customExercises = sqliteTable(
  "custom_exercises",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    familyId: text("family_id").notNull(),
    payload: text("payload").notNull(),
    active: integer("active").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_custom_owner_active").on(table.ownerId, table.active)],
);

export const favoriteExercises = sqliteTable(
  "favorite_exercises",
  {
    ownerId: text("owner_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.exerciseId] })],
);

// The hosted ingress identity owns existing journal rows. An application account
// adds password/session authentication without reassigning or rewriting history.
export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    platformId: text("platform_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    salt: text("salt").notNull(),
    recoveryHash: text("recovery_hash").notNull(),
    timeZone: text("time_zone").notNull(),
    bodyMassKg: integer("body_mass_kg"),
    revision: integer("revision").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("idx_accounts_platform").on(t.platformId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_sessions_account_expiry").on(t.accountId, t.expiresAt)],
);

export const authLimits = sqliteTable("auth_limits", {
  platformId: text("platform_id").primaryKey(),
  attempts: integer("attempts").notNull(),
  windowStart: integer("window_start").notNull(),
});

// Social data is server-owned, separate from journal replication and backups.
export const socialProfiles = sqliteTable(
  "social_profiles",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id),
    inviteCode: text("invite_code").notNull(),
    gym: text("gym").notNull().default(""),
    focus: text("focus").notNull().default(""),
    activeUntil: integer("active_until").notNull().default(0),
    weeklyTarget: integer("weekly_target").notNull().default(3),
  },
  (t) => [uniqueIndex("idx_social_invite").on(t.inviteCode)],
);

export const friendships = sqliteTable(
  "friendships",
  {
    lowId: text("low_id")
      .notNull()
      .references(() => accounts.id),
    highId: text("high_id")
      .notNull()
      .references(() => accounts.id),
    senderId: text("sender_id")
      .notNull()
      .references(() => accounts.id),
    status: text("status", { enum: ["pending", "accepted"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.lowId, t.highId] }),
    index("idx_friendships_high").on(t.highId),
  ],
);

export const workoutKudos = sqliteTable(
  "workout_kudos",
  {
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.accountId] })],
);

export const bodyweightDocuments = sqliteTable(
  "bodyweight_documents",
  {
    ownerId: text("owner_id").notNull(),
    docKey: text("doc_key").notNull(),
    payload: text("payload").notNull(),
    revision: integer("revision").notNull(),
    mutationId: text("mutation_id").notNull(),
    updatedAt: text("updated_at").notNull(),
    deleted: integer("deleted").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.docKey] })],
);

export const trainingMeetups = sqliteTable(
  "training_meetups",
  {
    id: text("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    startsAt: text("starts_at").notNull(),
    gym: text("gym").notNull(),
    cancelled: integer("cancelled").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_meetups_host_start").on(t.hostId, t.startsAt)],
);
export const meetupParticipants = sqliteTable(
  "meetup_participants",
  {
    meetupId: text("meetup_id")
      .notNull()
      .references(() => trainingMeetups.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    response: text("response").notNull(),
    gym: text("gym").notNull().default(""),
    workoutId: text("workout_id"),
  },
  (t) => [
    primaryKey({ columns: [t.meetupId, t.accountId] }),
    index("idx_meetup_participant").on(t.accountId, t.meetupId),
  ],
);

export const teamChallenges = sqliteTable(
  "team_challenges",
  {
    id: text("id").primaryKey(),
    hostId: text("host_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(),
    cancelled: integer("cancelled").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_challenge_host_start").on(t.hostId, t.startDate)],
);
export const challengeParticipants = sqliteTable(
  "challenge_participants",
  {
    challengeId: text("challenge_id")
      .notNull()
      .references(() => teamChallenges.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    response: text("response").notNull(),
    target: integer("target").notNull(),
    joinedAt: text("joined_at"),
  },
  (t) => [
    primaryKey({ columns: [t.challengeId, t.accountId] }),
    index("idx_challenge_participant").on(t.accountId, t.challengeId),
  ],
);

export const machineModels = sqliteTable("machine_models", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), payload: text("payload").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] })]);
export const machineInstances = sqliteTable("machine_instances", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), modelId: text("model_id").notNull(),
  payload: text("payload").notNull(), revision: integer("revision").notNull().default(1),
  active: integer("active").notNull().default(1), updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), index("idx_machines_owner").on(t.ownerId, t.active)]);
