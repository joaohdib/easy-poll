import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  lt,
  sql,
  type SQL
} from 'drizzle-orm';
import type { EasyPollDatabase } from '../db/database';
import { groups, members, pollOptions, polls, pollVotes } from '../db/schema';

export const HISTORY_LIST_QUERY_COUNT = 2;
export const HISTORY_DETAIL_QUERY_COUNT = 3;

export interface HistoryRepositoryFilters {
  offset: number;
  limit: number;
  search: string | null;
  fromTimestamp: number | null;
  toExclusiveTimestamp: number | null;
}

export interface HistoryListRow {
  messageId: string;
  question: string;
  createdAt: number;
  creatorId: string | null;
  creatorName: string | null;
  allowMultipleAnswers: boolean;
  optionCount: number;
  votesSnapshotAvailable: boolean;
  participantCount: number;
  selectionCount: number;
}

export interface HistoryListRows {
  totalItems: number;
  items: HistoryListRow[];
}

export interface HistoryDetailRows {
  poll: {
    messageId: string;
    groupId: string;
    question: string;
    createdAt: number;
    allowMultipleAnswers: boolean;
    creatorId: string | null;
    creatorName: string | null;
    votesSnapshotAvailable: boolean;
    votesSnapshotAt: number | null;
  };
  options: Array<{
    id: number;
    text: string;
    position: number;
    selectionCount: number;
  }>;
  votes: Array<{
    voterId: string;
    voterName: string;
    votedAt: number | null;
    optionId: number;
    optionText: string;
    optionPosition: number;
  }>;
}

export class HistoryRepository {
  constructor(private readonly db: EasyPollDatabase) {}

  listGroupPolls(groupId: string, filters: HistoryRepositoryFilters): HistoryListRows | null {
    const pollFilter = buildPollFilter(filters);
    // The filtering conditions live in the LEFT JOIN so an existing group
    // still produces a count row when no poll matches.
    const totalRow = this.db.select({
      groupId: groups.id,
      totalItems: count(polls.messageId)
    }).from(groups).leftJoin(
      polls,
      and(eq(polls.groupId, groups.id), pollFilter)
    ).where(eq(groups.id, groupId)).groupBy(groups.id).get();

    if (!totalRow) return null;

    const items = this.db.select({
      messageId: polls.messageId,
      question: polls.question,
      createdAt: polls.createdAt,
      creatorId: polls.creatorId,
      creatorName: members.displayName,
      allowMultipleAnswers: polls.allowMultipleAnswers,
      optionCount: countDistinct(pollOptions.id),
      votesSnapshotAvailable: polls.votesSnapshotAvailable,
      participantCount: countDistinct(pollVotes.voterId),
      selectionCount: countDistinct(pollVotes.id)
    }).from(polls).leftJoin(
      members,
      eq(members.id, polls.creatorId)
    ).leftJoin(
      pollOptions,
      eq(pollOptions.pollId, polls.messageId)
    ).leftJoin(
      pollVotes,
      eq(pollVotes.pollId, polls.messageId)
    ).where(and(eq(polls.groupId, groupId), pollFilter)).groupBy(
      polls.messageId,
      polls.question,
      polls.createdAt,
      polls.creatorId,
      members.displayName,
      polls.allowMultipleAnswers,
      polls.votesSnapshotAvailable
    ).orderBy(
      desc(polls.createdAt),
      desc(polls.messageId)
    ).limit(filters.limit).offset(filters.offset).all();

    return {
      totalItems: Number(totalRow.totalItems) || 0,
      items: items.map((item) => ({
        ...item,
        optionCount: Number(item.optionCount) || 0,
        participantCount: Number(item.participantCount) || 0,
        selectionCount: Number(item.selectionCount) || 0
      }))
    };
  }

  loadPollDetail(groupId: string, messageId: string): HistoryDetailRows | null {
    const poll = this.db.select({
      messageId: polls.messageId,
      groupId: polls.groupId,
      question: polls.question,
      createdAt: polls.createdAt,
      allowMultipleAnswers: polls.allowMultipleAnswers,
      creatorId: polls.creatorId,
      creatorName: members.displayName,
      votesSnapshotAvailable: polls.votesSnapshotAvailable,
      votesSnapshotAt: polls.votesSnapshotAt
    }).from(polls).leftJoin(
      members,
      eq(members.id, polls.creatorId)
    ).where(and(
      eq(polls.groupId, groupId),
      eq(polls.messageId, messageId)
    )).get();

    if (!poll) return null;

    const options = this.db.select({
      id: pollOptions.id,
      text: pollOptions.text,
      position: pollOptions.position,
      selectionCount: count(pollVotes.id)
    }).from(pollOptions).leftJoin(
      pollVotes,
      eq(pollVotes.optionId, pollOptions.id)
    ).where(eq(pollOptions.pollId, messageId)).groupBy(
      pollOptions.id,
      pollOptions.text,
      pollOptions.position
    ).orderBy(asc(pollOptions.position), asc(pollOptions.id)).all().map((option) => ({
      ...option,
      selectionCount: Number(option.selectionCount) || 0
    }));

    const votes = this.db.select({
      voterId: pollVotes.voterId,
      voterName: members.displayName,
      votedAt: pollVotes.votedAt,
      optionId: pollOptions.id,
      optionText: pollOptions.text,
      optionPosition: pollOptions.position
    }).from(pollVotes).innerJoin(
      members,
      eq(members.id, pollVotes.voterId)
    ).innerJoin(
      pollOptions,
      eq(pollOptions.id, pollVotes.optionId)
    ).where(eq(pollVotes.pollId, messageId)).orderBy(
      asc(members.displayName),
      asc(pollVotes.voterId),
      asc(pollOptions.position),
      asc(pollOptions.id)
    ).all();

    return { poll, options, votes };
  }
}

function buildPollFilter(filters: HistoryRepositoryFilters): SQL<unknown> | undefined {
  const conditions: SQL<unknown>[] = [];
  if (filters.search) {
    const escapedSearch = filters.search.replace(/[\\%_]/g, '\\$&');
    conditions.push(sql`lower(${polls.question}) LIKE lower(${`%${escapedSearch}%`}) ESCAPE '\\'`);
  }
  if (filters.fromTimestamp !== null) {
    conditions.push(gte(polls.createdAt, filters.fromTimestamp));
  }
  if (filters.toExclusiveTimestamp !== null) {
    conditions.push(lt(polls.createdAt, filters.toExclusiveTimestamp));
  }
  return and(...conditions);
}
