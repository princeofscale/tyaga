import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
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
