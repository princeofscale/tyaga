import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export const workouts = sqliteTable('workouts', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  date: text('date').notNull(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_workouts_owner_date').on(table.ownerId, table.date)]);

export const settings = sqliteTable('settings', {
  ownerId: text('owner_id').primaryKey(),
  payload: text('payload').notNull(),
});
