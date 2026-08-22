import { asc, count, desc, eq, inArray, max, min } from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import { processedMessages, syncState, type ProcessedMessageRecord } from '../db/schema';
import type { GroupSyncStatus, ProcessedMessageMetadata } from '../domain/types';

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

  hasProcessedMessage(messageId: string): boolean {
    return Boolean(this.db.select({ messageId: processedMessages.messageId })
      .from(processedMessages)
      .where(eq(processedMessages.messageId, messageId))
      .get());
  }

  findProcessedIds(messageIds: string[]): Set<string> {
    const uniqueIds = [...new Set(messageIds.filter(Boolean))];
    const found = new Set<string>();
    for (let offset = 0; offset < uniqueIds.length; offset += PROCESSED_MESSAGE_BATCH_SIZE) {
      const batch = uniqueIds.slice(offset, offset + PROCESSED_MESSAGE_BATCH_SIZE);
      this.db.select({ messageId: processedMessages.messageId })
        .from(processedMessages)
        .where(inArray(processedMessages.messageId, batch))
        .all()
        .forEach(({ messageId }) => found.add(messageId));
    }
    return found;
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

  getSyncStatus(groupId: string): GroupSyncStatus {
    const saved = this.findSyncState(groupId);
    const bounds = saved || this.getGroupBounds(groupId);
    return {
      groupId,
      messagesProcessed: Number(bounds.messagesProcessed) || 0,
      oldestProcessedTimestamp: bounds.oldestProcessedTimestamp ?? null,
      newestProcessedTimestamp: bounds.newestProcessedTimestamp ?? null,
      lastSyncAt: saved?.lastSyncAt ?? null
    };
  }

  getOldestProcessedMessage(groupId: string): ProcessedMessageRecord | null {
    return this.db.select().from(processedMessages)
      .where(eq(processedMessages.groupId, groupId))
      .orderBy(asc(processedMessages.messageTimestamp), asc(processedMessages.messageId))
      .limit(1)
      .get() || null;
  }

  getNewestProcessedMessage(groupId: string): ProcessedMessageRecord | null {
    return this.db.select().from(processedMessages)
      .where(eq(processedMessages.groupId, groupId))
      .orderBy(desc(processedMessages.messageTimestamp), desc(processedMessages.messageId))
      .limit(1)
      .get() || null;
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
