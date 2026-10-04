import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Billing protection only. Never persist keys, prompts, reviews or AI responses.
export const aiRequests=sqliteTable('ai_requests',{
  requestId:text('request_id').primaryKey(),
  actor:text('actor').notNull(),
  day:text('day').notNull(),
  createdAt:integer('created_at').notNull(),
  status:text('status').notNull(),
  model:text('model').notNull(),
  inputTokens:integer('input_tokens'),
  outputTokens:integer('output_tokens'),
},table=>[index('idx_ai_requests_day_actor').on(table.day,table.actor),index('idx_ai_requests_actor_created').on(table.actor,table.createdAt)]);
