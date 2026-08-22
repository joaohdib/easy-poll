import type {
  PollHistoryDetail,
  PollHistoryListResult,
  PollHistoryParticipant
} from '../domain/types';
import { HistoryRepository } from '../repositories/history.repository';

export const HISTORY_TIMEZONE = 'America/Sao_Paulo';
export const HISTORY_DEFAULT_PAGE = 1;
export const HISTORY_DEFAULT_PAGE_SIZE = 25;
export const HISTORY_MAX_PAGE_SIZE = 100;
export const HISTORY_MAX_SEARCH_LENGTH = 255;

export interface HistoryQueryInput {
  page?: unknown;
  pageSize?: unknown;
  search?: unknown;
  from?: unknown;
  to?: unknown;
}

export class HistoryQueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryQueryValidationError';
  }
}

export class HistoryQueryService {
  constructor(private readonly repository: HistoryRepository) {}

  listGroupHistory(groupId: string, input: HistoryQueryInput): PollHistoryListResult | null {
    const filters = validateHistoryQuery(input);
    const rows = this.repository.listGroupPolls(groupId, {
      offset: (filters.page - 1) * filters.pageSize,
      limit: filters.pageSize,
      search: filters.search,
      fromTimestamp: filters.fromTimestamp,
      toExclusiveTimestamp: filters.toExclusiveTimestamp
    });
    if (!rows) return null;
    return {
      items: rows.items.map((poll) => {
        const votesSnapshotAvailable = poll.votesSnapshotAvailable === true;
        return {
          messageId: poll.messageId,
          question: poll.question,
          createdAt: poll.createdAt,
          creator: poll.creatorId && poll.creatorName
            ? { id: poll.creatorId, displayName: poll.creatorName }
            : null,
          allowMultipleAnswers: poll.allowMultipleAnswers,
          optionCount: poll.optionCount,
          votesSnapshotAvailable,
          participantCount: votesSnapshotAvailable ? poll.participantCount : null,
          selectionCount: votesSnapshotAvailable ? poll.selectionCount : null
        };
      }),
      pagination: {
        page: filters.page,
        pageSize: filters.pageSize,
        totalItems: rows.totalItems,
        totalPages: rows.totalItems ? Math.ceil(rows.totalItems / filters.pageSize) : 0
      }
    };
  }

  getPollDetail(groupId: string, messageId: string): PollHistoryDetail | null {
    const rows = this.repository.loadPollDetail(groupId, messageId);
    if (!rows) return null;

    const votesSnapshotAvailable = rows.poll.votesSnapshotAvailable === true;
    const participantsById = new Map<string, PollHistoryParticipant>();
    rows.votes.forEach((vote) => {
      const participant = participantsById.get(vote.voterId) || {
        id: vote.voterId,
        displayName: vote.voterName,
        votedAt: vote.votedAt,
        selectedOptions: []
      };
      if (participant.votedAt === null && vote.votedAt !== null) {
        participant.votedAt = vote.votedAt;
      }
      participant.selectedOptions.push({
        id: vote.optionId,
        text: vote.optionText,
        position: vote.optionPosition
      });
      participantsById.set(vote.voterId, participant);
    });

    const participants = [...participantsById.values()];
    const selectionCount = rows.votes.length;
    return {
      messageId: rows.poll.messageId,
      groupId: rows.poll.groupId,
      question: rows.poll.question,
      createdAt: rows.poll.createdAt,
      allowMultipleAnswers: rows.poll.allowMultipleAnswers,
      creator: rows.poll.creatorId && rows.poll.creatorName
        ? { id: rows.poll.creatorId, displayName: rows.poll.creatorName }
        : null,
      votesSnapshotAvailable,
      votesSnapshotAt: rows.poll.votesSnapshotAt,
      participantCount: votesSnapshotAvailable ? participants.length : null,
      selectionCount: votesSnapshotAvailable ? selectionCount : null,
      options: rows.options.map((option) => ({
        ...option,
        selectionCount: votesSnapshotAvailable ? option.selectionCount : null
      })),
      participants: votesSnapshotAvailable ? participants : null
    };
  }
}

interface ValidatedHistoryQuery {
  page: number;
  pageSize: number;
  search: string | null;
  fromTimestamp: number | null;
  toExclusiveTimestamp: number | null;
}

export function validateHistoryQuery(input: HistoryQueryInput): ValidatedHistoryQuery {
  const page = parsePositiveInteger(input.page, HISTORY_DEFAULT_PAGE, 'page');
  const pageSize = parsePositiveInteger(input.pageSize, HISTORY_DEFAULT_PAGE_SIZE, 'pageSize');
  if (pageSize > HISTORY_MAX_PAGE_SIZE) {
    throw new HistoryQueryValidationError(
      `pageSize deve ser menor ou igual a ${HISTORY_MAX_PAGE_SIZE}.`
    );
  }
  if (input.search !== undefined && typeof input.search !== 'string') {
    throw new HistoryQueryValidationError('search deve ser um texto.');
  }
  const search = typeof input.search === 'string' ? input.search.trim() : '';
  if (search.length > HISTORY_MAX_SEARCH_LENGTH) {
    throw new HistoryQueryValidationError(
      `search deve ter no máximo ${HISTORY_MAX_SEARCH_LENGTH} caracteres.`
    );
  }

  const fromDate = parseLocalDate(input.from, 'from');
  const toDate = parseLocalDate(input.to, 'to');
  const fromTimestamp = fromDate ? localDayStartEpochSeconds(fromDate) : null;
  const toExclusiveTimestamp = toDate
    ? localDayStartEpochSeconds(addCalendarDays(toDate, 1))
    : null;
  if (fromTimestamp !== null && toExclusiveTimestamp !== null && fromTimestamp >= toExclusiveTimestamp) {
    throw new HistoryQueryValidationError('from não pode ser posterior a to.');
  }

  return {
    page,
    pageSize,
    search: search || null,
    fromTimestamp,
    toExclusiveTimestamp
  };
}

function parsePositiveInteger(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HistoryQueryValidationError(`${field} deve ser um número inteiro positivo.`);
  }
  if ((typeof value === 'string' && !/^\d+$/.test(value)) || value === '') {
    throw new HistoryQueryValidationError(`${field} deve ser um número inteiro positivo.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HistoryQueryValidationError(`${field} deve ser um número inteiro positivo.`);
  }
  return parsed;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseLocalDate(value: unknown, field: string): CalendarDate | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new HistoryQueryValidationError(`${field} deve usar o formato YYYY-MM-DD.`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new HistoryQueryValidationError(`${field} deve usar o formato YYYY-MM-DD.`);
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    check.getUTCFullYear() !== date.year
    || check.getUTCMonth() !== date.month - 1
    || check.getUTCDate() !== date.day
  ) {
    throw new HistoryQueryValidationError(`${field} contém uma data inválida.`);
  }
  return date;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

export function localDayStartEpochSeconds(date: CalendarDate): number {
  const localAsUtc = Date.UTC(date.year, date.month - 1, date.day);
  let instant = localAsUtc;
  // Re-evaluating the offset at the candidate instant handles historical DST
  // changes as well as the current UTC-03:00 offset in São Paulo.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    instant = localAsUtc - timezoneOffsetMilliseconds(instant, HISTORY_TIMEZONE);
  }
  return Math.floor(instant / 1000);
}

function timezoneOffsetMilliseconds(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return representedAsUtc - instant;
}
