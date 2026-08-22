import { asc, count, eq } from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import {
  groups,
  members,
  pollOptions,
  polls,
  pollVotes,
  syncState
} from '../db/schema';
import type {
  GroupSyncStatus,
  LocalGroup,
  PollAnalysis,
  PollAnalysisInput,
  PollParticipant
} from '../domain/types';

export const STATS_DATASET_QUERY_COUNT = 4;

export interface PersistedStatsDataset {
  analysis: PollAnalysisInput;
  localData: GroupSyncStatus;
}

export class StatsRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  loadGroupDataset(groupId: string): PersistedStatsDataset | null {
    // Four fixed queries: group/sync state, polls/creators, options and votes.
    // The child collections are filtered by a join on group_id, avoiding N+1
    // queries and SQLite parameter limits for large poll sets.
    const groupRow = this.db.select({
      id: groups.id,
      name: groups.name,
      messagesProcessed: syncState.messagesProcessed,
      oldestProcessedTimestamp: syncState.oldestProcessedTimestamp,
      newestProcessedTimestamp: syncState.newestProcessedTimestamp,
      lastSyncAt: syncState.lastSyncAt
    }).from(groups).leftJoin(
      syncState,
      eq(syncState.groupId, groups.id)
    ).where(eq(groups.id, groupId)).get();

    if (!groupRow) return null;

    const pollRows = this.db.select({
      messageId: polls.messageId,
      question: polls.question,
      createdAt: polls.createdAt,
      creatorId: polls.creatorId,
      creatorName: members.displayName,
      votesSnapshotAvailable: polls.votesSnapshotAvailable
    }).from(polls).leftJoin(
      members,
      eq(members.id, polls.creatorId)
    ).where(eq(polls.groupId, groupId)).orderBy(
      asc(polls.createdAt),
      asc(polls.messageId)
    ).all();

    const optionRows = this.db.select({
      id: pollOptions.id,
      pollId: pollOptions.pollId,
      text: pollOptions.text,
      position: pollOptions.position
    }).from(pollOptions).innerJoin(
      polls,
      eq(polls.messageId, pollOptions.pollId)
    ).where(eq(polls.groupId, groupId)).orderBy(
      asc(pollOptions.pollId),
      asc(pollOptions.position)
    ).all();

    const voteRows = this.db.select({
      pollId: pollVotes.pollId,
      voterId: pollVotes.voterId,
      voterName: members.displayName,
      optionId: pollVotes.optionId,
      optionText: pollOptions.text,
      optionPosition: pollOptions.position,
      votedAt: pollVotes.votedAt
    }).from(pollVotes).innerJoin(
      polls,
      eq(polls.messageId, pollVotes.pollId)
    ).innerJoin(
      pollOptions,
      eq(pollOptions.id, pollVotes.optionId)
    ).innerJoin(
      members,
      eq(members.id, pollVotes.voterId)
    ).where(eq(polls.groupId, groupId)).orderBy(
      asc(pollVotes.pollId),
      asc(pollVotes.voterId),
      asc(pollOptions.position)
    ).all();

    const optionsByPoll = new Map<string, string[]>();
    optionRows.forEach((option) => {
      const options = optionsByPoll.get(option.pollId) || [];
      // normalizePolls already presents unique option texts to StatsService.
      // Keep that legacy contract after the FK-based database association.
      if (!options.includes(option.text)) options.push(option.text);
      optionsByPoll.set(option.pollId, options);
    });

    const participantsByPoll = new Map<string, Map<string, PollParticipant>>();
    voteRows.forEach((vote) => {
      const voters = participantsByPoll.get(vote.pollId) || new Map<string, PollParticipant>();
      const participant = voters.get(vote.voterId) || {
        userId: vote.voterId,
        name: vote.voterName,
        selectedOptions: [],
        voteTimestamp: vote.votedAt
      };
      // option_id is resolved by the database join before adapting to the
      // current text-based StatsService contract. This never guesses by text.
      participant.selectedOptions.push(vote.optionText);
      if (participant.voteTimestamp === null && vote.votedAt !== null) {
        participant.voteTimestamp = vote.votedAt;
      }
      voters.set(vote.voterId, participant);
      participantsByPoll.set(vote.pollId, voters);
    });

    const pollAnalysis: PollAnalysis[] = pollRows.map((poll) => {
      const votesAvailable = poll.votesSnapshotAvailable === true;
      const participants = votesAvailable
        ? [...(participantsByPoll.get(poll.messageId)?.values() || [])]
        : [];
      return {
        id: poll.messageId,
        question: poll.question,
        timestamp: poll.createdAt,
        options: optionsByPoll.get(poll.messageId) || [],
        votesAvailable,
        participants,
        votes: participants.map((participant) => ({
          voterId: participant.userId,
          voterName: participant.name,
          selectedOptions: [...participant.selectedOptions],
          timestamp: participant.voteTimestamp
        })),
        creatorId: poll.creatorId,
        creatorName: poll.creatorName
      };
    });

    return {
      analysis: {
        group: { id: groupRow.id, name: groupRow.name },
        pollsFound: pollAnalysis.length,
        polls: pollAnalysis
      },
      localData: {
        groupId: groupRow.id,
        messagesProcessed: Number(groupRow.messagesProcessed) || 0,
        oldestProcessedTimestamp: groupRow.oldestProcessedTimestamp ?? null,
        newestProcessedTimestamp: groupRow.newestProcessedTimestamp ?? null,
        lastSyncAt: groupRow.lastSyncAt ?? null
      }
    };
  }

  listLocalGroups(): LocalGroup[] {
    return this.db.select({
      id: groups.id,
      name: groups.name,
      pollCount: count(polls.messageId),
      lastSyncAt: syncState.lastSyncAt
    }).from(groups).leftJoin(
      polls,
      eq(polls.groupId, groups.id)
    ).leftJoin(
      syncState,
      eq(syncState.groupId, groups.id)
    ).groupBy(
      groups.id,
      groups.name,
      syncState.lastSyncAt
    ).orderBy(asc(groups.name), asc(groups.id)).all().map((group) => ({
      ...group,
      pollCount: Number(group.pollCount) || 0,
      lastSyncAt: group.lastSyncAt ?? null
    }));
  }
}
