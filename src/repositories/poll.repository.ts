import { eq } from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import {
  members,
  pollOptions,
  polls,
  pollVotes,
  type PollOptionRecord,
  type PollRecord
} from '../db/schema';
import type { PersistablePoll, PersistablePollOption } from '../domain/types';

export interface PersistedVoteChoice {
  voterId: string;
  optionId: number;
  votedAt: number | null;
}

export interface PersistedPollSnapshot {
  poll: PollRecord;
  options: PollOptionRecord[];
  votes: Array<{
    voterId: string;
    voterName: string;
    optionId: number;
    votedAt: number | null;
  }>;
}

export class PollRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  upsertPoll(groupId: string, snapshot: PersistablePoll): PollRecord | null {
    if (!snapshot.messageId) return null;
    const existing = this.findRecordByMessageId(snapshot.messageId);
    if (!existing) {
      if (snapshot.timestamp === null) return null;
      this.db.insert(polls).values({
        messageId: snapshot.messageId,
        groupId,
        creatorId: snapshot.creatorId,
        question: snapshot.question,
        createdAt: snapshot.timestamp,
        allowMultipleAnswers: snapshot.allowMultipleAnswers
      }).run();
    } else {
      this.db.update(polls).set({
        groupId,
        question: snapshot.question,
        allowMultipleAnswers: snapshot.allowMultipleAnswers,
        ...(snapshot.creatorId ? { creatorId: snapshot.creatorId } : {}),
        ...(snapshot.timestamp !== null ? { createdAt: snapshot.timestamp } : {})
      }).where(eq(polls.messageId, snapshot.messageId)).run();
    }
    return this.findRecordByMessageId(snapshot.messageId);
  }

  reconcileOptions(pollId: string, snapshots: PersistablePollOption[]): PollOptionRecord[] {
    const existing = this.listOptions(pollId);
    // A poll creation message normally has a complete option list. An empty
    // list is treated as partial data so it cannot erase known options/votes.
    if (!snapshots.length) return existing;

    const duplicateLocalIds = findDuplicateLocalIds(snapshots);
    if (duplicateLocalIds.length) {
      throw new Error('A enquete normalizada contém identificadores locais de opção duplicados.');
    }

    const unused = new Set(existing.map((option) => option.id));
    const matches = snapshots.map((snapshot) => {
      const byLocalId = snapshot.whatsappLocalId === null ? undefined : existing.find((option) => (
        unused.has(option.id) && option.whatsappLocalId === snapshot.whatsappLocalId
      ));
      const byPosition = existing.find((option) => (
        unused.has(option.id) && option.position === snapshot.position
      ));
      const matched = byLocalId || byPosition || null;
      if (matched) unused.delete(matched.id);
      return { snapshot, matched };
    });

    unused.forEach((id) => {
      this.db.delete(pollOptions).where(eq(pollOptions.id, id)).run();
    });

    // Temporary positions/local IDs avoid unique-constraint collisions when
    // a later complete snapshot legitimately reorders option metadata.
    matches.forEach(({ matched }) => {
      if (!matched) return;
      this.db.update(pollOptions).set({
        position: -matched.id - 1,
        whatsappLocalId: null
      }).where(eq(pollOptions.id, matched.id)).run();
    });

    matches.forEach(({ snapshot, matched }) => {
      if (matched) {
        this.db.update(pollOptions).set({
          text: snapshot.text,
          position: snapshot.position,
          whatsappLocalId: snapshot.whatsappLocalId ?? matched.whatsappLocalId
        }).where(eq(pollOptions.id, matched.id)).run();
      } else {
        this.db.insert(pollOptions).values({ pollId, ...snapshot }).run();
      }
    });

    return this.listOptions(pollId);
  }

  replaceVotes(pollId: string, choices: PersistedVoteChoice[]): void {
    this.db.delete(pollVotes).where(eq(pollVotes.pollId, pollId)).run();
    choices.forEach((choice) => {
      this.db.insert(pollVotes).values({ pollId, ...choice }).onConflictDoNothing().run();
    });
  }

  findByMessageId(messageId: string): PersistedPollSnapshot | null {
    const poll = this.findRecordByMessageId(messageId);
    if (!poll) return null;
    return {
      poll,
      options: this.listOptions(messageId),
      votes: this.db.select({
        voterId: pollVotes.voterId,
        voterName: members.displayName,
        optionId: pollVotes.optionId,
        votedAt: pollVotes.votedAt
      }).from(pollVotes).innerJoin(
        members,
        eq(members.id, pollVotes.voterId)
      ).where(eq(pollVotes.pollId, messageId)).all()
    };
  }

  listByGroup(groupId: string): PersistedPollSnapshot[] {
    return this.db.select({ messageId: polls.messageId }).from(polls)
      .where(eq(polls.groupId, groupId)).all()
      .flatMap(({ messageId }) => {
        const snapshot = this.findByMessageId(messageId);
        return snapshot ? [snapshot] : [];
      });
  }

  private findRecordByMessageId(messageId: string): PollRecord | null {
    return this.db.select().from(polls).where(eq(polls.messageId, messageId)).get() || null;
  }

  private listOptions(pollId: string): PollOptionRecord[] {
    return this.db.select().from(pollOptions).where(eq(pollOptions.pollId, pollId))
      .orderBy(pollOptions.position).all();
  }
}

function findDuplicateLocalIds(options: PersistablePollOption[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  options.forEach(({ whatsappLocalId }) => {
    if (whatsappLocalId === null) return;
    if (seen.has(whatsappLocalId)) duplicates.add(whatsappLocalId);
    seen.add(whatsappLocalId);
  });
  return [...duplicates];
}
