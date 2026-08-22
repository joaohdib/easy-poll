import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core';

/**
 * All persisted timestamps use Unix epoch seconds, matching WhatsApp timestamps.
 * Integer timestamp columns intentionally use number mode rather than Date mapping
 * so callers cannot silently mix seconds with JavaScript milliseconds.
 */
export const PERSISTED_TIMESTAMP_UNIT = 'unix-seconds' as const;

export const groups = sqliteTable('groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull()
});

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull()
});

export const polls = sqliteTable('polls', {
  messageId: text('message_id').primaryKey(),
  groupId: text('group_id').notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  creatorId: text('creator_id')
    .references(() => members.id, { onDelete: 'set null' }),
  question: text('question').notNull(),
  createdAt: integer('created_at').notNull(),
  allowMultipleAnswers: integer('allow_multiple_answers', { mode: 'boolean' }).notNull()
}, (table) => [
  index('polls_group_id_created_at_idx').on(table.groupId, table.createdAt)
]);

export const pollOptions = sqliteTable('poll_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pollId: text('poll_id').notNull()
    .references(() => polls.messageId, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  position: integer('position').notNull(),
  whatsappLocalId: text('whatsapp_local_id')
}, (table) => [
  uniqueIndex('poll_options_poll_id_position_unique').on(table.pollId, table.position),
  uniqueIndex('poll_options_poll_id_whatsapp_local_id_unique')
    .on(table.pollId, table.whatsappLocalId)
]);

export const pollVotes = sqliteTable('poll_votes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pollId: text('poll_id').notNull()
    .references(() => polls.messageId, { onDelete: 'cascade' }),
  voterId: text('voter_id').notNull()
    .references(() => members.id),
  optionId: integer('option_id').notNull()
    .references(() => pollOptions.id, { onDelete: 'cascade' }),
  votedAt: integer('voted_at')
}, (table) => [
  uniqueIndex('poll_votes_poll_id_voter_id_option_id_unique')
    .on(table.pollId, table.voterId, table.optionId),
  index('poll_votes_voter_id_poll_id_idx').on(table.voterId, table.pollId)
]);

export const processedMessages = sqliteTable('processed_messages', {
  messageId: text('message_id').primaryKey(),
  groupId: text('group_id').notNull()
    .references(() => groups.id, { onDelete: 'cascade' }),
  messageType: text('message_type').notNull(),
  messageTimestamp: integer('message_timestamp').notNull()
}, (table) => [
  index('processed_messages_group_id_message_timestamp_idx')
    .on(table.groupId, table.messageTimestamp)
]);

export const syncState = sqliteTable('sync_state', {
  groupId: text('group_id').primaryKey()
    .references(() => groups.id, { onDelete: 'cascade' }),
  lastSyncAt: integer('last_sync_at'),
  oldestProcessedTimestamp: integer('oldest_processed_timestamp'),
  newestProcessedTimestamp: integer('newest_processed_timestamp'),
  messagesProcessed: integer('messages_processed').notNull().default(0)
});

export type GroupRecord = typeof groups.$inferSelect;
export type NewGroupRecord = typeof groups.$inferInsert;
export type MemberRecord = typeof members.$inferSelect;
export type NewMemberRecord = typeof members.$inferInsert;
export type PollRecord = typeof polls.$inferSelect;
export type NewPollRecord = typeof polls.$inferInsert;
export type PollOptionRecord = typeof pollOptions.$inferSelect;
export type NewPollOptionRecord = typeof pollOptions.$inferInsert;
export type PollVoteRecord = typeof pollVotes.$inferSelect;
export type NewPollVoteRecord = typeof pollVotes.$inferInsert;
export type ProcessedMessageRecord = typeof processedMessages.$inferSelect;
export type NewProcessedMessageRecord = typeof processedMessages.$inferInsert;
export type SyncStateRecord = typeof syncState.$inferSelect;
export type NewSyncStateRecord = typeof syncState.$inferInsert;
