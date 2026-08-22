import { count, eq, max, min } from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import { processedMessages, syncState } from '../db/schema';
import type { ProcessedMessageMetadata } from '../domain/types';

export const PROCESSED_MESSAGE_BATCH_SIZE = 250;

export class ScanStateRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  insertProcessedMessages(messages: ProcessedMessageMetadata[]): void {
    for (let offset = 0; offset < messages.length; offset += PROCESSED_MESSAGE_BATCH_SIZE) {
      const batch = messages.slice(offset, offset + PROCESSED_MESSAGE_BATCH_SIZE).map((message) => ({
        messageId: message.id,
        groupId: message.groupId,
        messageType: message.type,
        messageTimestamp: message.timestamp
      }));
      if (batch.length) {
        this.db.insert(processedMessages).values(batch).onConflictDoNothing().run();
      }
    }
  }

  countByGroup(groupId: string): number {
    return this.getGroupBounds(groupId).messagesProcessed;
  }

  updateAfterScan(groupId: string, lastSyncAt: number): void {
    const bounds = this.getGroupBounds(groupId);
    this.db.insert(syncState).values({ groupId, lastSyncAt, ...bounds }).onConflictDoUpdate({
      target: syncState.groupId,
      set: { lastSyncAt, ...bounds }
    }).run();
  }

  findSyncState(groupId: string) {
    return this.db.select().from(syncState).where(eq(syncState.groupId, groupId)).get() || null;
  }

  private getGroupBounds(groupId: string) {
    const aggregate = this.db.select({
      messagesProcessed: count(),
      oldestProcessedTimestamp: min(processedMessages.messageTimestamp),
      newestProcessedTimestamp: max(processedMessages.messageTimestamp)
    }).from(processedMessages).where(eq(processedMessages.groupId, groupId)).get();
    return {
      messagesProcessed: Number(aggregate?.messagesProcessed) || 0,
      oldestProcessedTimestamp: aggregate?.oldestProcessedTimestamp ?? null,
      newestProcessedTimestamp: aggregate?.newestProcessedTimestamp ?? null
    };
  }
}
