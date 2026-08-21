import type {
  Poll,
  PollAnalysis,
  PollAnalysisInput,
  PollScanResult,
  PollVote
} from '../domain/types';

interface SerializedIdLike {
  _serialized?: unknown;
}

export interface PollOptionSource {
  name?: unknown;
  localId?: unknown;
}

export interface PollMessageSource {
  id?: unknown;
  pollName?: unknown;
  timestamp?: unknown;
  author?: unknown;
  participant?: unknown;
  from?: unknown;
  fromMe?: unknown;
  pollOptions?: unknown;
  allowMultipleAnswers?: unknown;
}

export interface RecoveredVoteSource {
  voterId: unknown;
  selectedOptionIds: unknown[];
  selectedOptions: string[];
  timestamp: unknown;
}

interface RawVote {
  voterId?: unknown;
  voterName?: unknown;
  name?: unknown;
  selectedOptions?: unknown;
  voteTimestamp?: unknown;
  timestamp?: unknown;
}

interface RawPoll {
  messageId?: unknown;
  question?: unknown;
  timestamp?: unknown;
  options?: unknown;
  votesAvailable?: unknown;
  votes?: RawVote[];
  creatorId?: unknown;
  creatorName?: unknown;
  authorId?: unknown;
  authorName?: unknown;
  author?: unknown;
  participant?: unknown;
  participantName?: unknown;
  from?: unknown;
  fromName?: unknown;
}

export interface PollScanSource {
  group?: { id?: unknown; name?: unknown };
  pollsFound?: unknown;
  polls?: RawPoll[];
}

interface OrderedParticipant {
  userId: string;
  name: string;
  selectedOptions: string[];
  voteTimestamp: number | null;
  order: number;
}

export function normalizeScannedPoll(
  message: PollMessageSource,
  namesById: Map<string, string>,
  ownId: string | null,
  recoveredVotes: RecoveredVoteSource[] | null,
  votesError: string | null
): Poll {
  const contextualCreatorId = normalizeWhatsAppId(message.participant)
    || normalizeWhatsAppId(message.from);
  const creatorId = normalizeWhatsAppId(message.author)
    || (message.fromMe ? ownId : null)
    || (contextualCreatorId && !contextualCreatorId.endsWith('@g.us') ? contextualCreatorId : null);
  const messageId = normalizeWhatsAppId(message.id);
  const votes: PollVote[] = (recoveredVotes || []).map((vote) => {
    const voterId = normalizeWhatsAppId(vote.voterId);
    return {
      voterId,
      voterName: resolveKnownName(voterId, namesById),
      selectedOptionIds: Array.isArray(vote.selectedOptionIds) ? vote.selectedOptionIds : [],
      selectedOptions: Array.isArray(vote.selectedOptions) ? vote.selectedOptions : [],
      timestamp: normalizeVoteTimestamp(vote.timestamp)
    };
  });

  return {
    messageId,
    question: cleanText(message.pollName, 500) || 'Enquete sem pergunta disponível',
    timestamp: Number(message.timestamp) || null,
    creatorId,
    creatorName: resolveKnownName(creatorId, namesById),
    options: normalizePollOptions(message.pollOptions),
    allowMultipleAnswers: Boolean(message.allowMultipleAnswers),
    votes,
    voteCount: votes.length,
    votesAvailable: recoveredVotes !== null,
    votesError
  };
}

export function normalizePollScan(scan: PollScanSource | PollScanResult): PollAnalysisInput {
  const sourcePolls = Array.isArray(scan?.polls) ? scan.polls : [];
  const group = scan?.group && typeof scan.group === 'object'
    ? {
        id: cleanString(scan.group.id),
        name: cleanString(scan.group.name) || 'Grupo sem nome'
      }
    : null;

  return {
    group,
    pollsFound: Number.isInteger(scan?.pollsFound) ? Number(scan.pollsFound) : sourcePolls.length,
    polls: normalizePolls({ polls: sourcePolls })
  };
}

export function normalizePolls(scan: PollScanSource): PollAnalysis[] {
  const sourcePolls = Array.isArray(scan?.polls) ? scan.polls : [];
  const seenMessageIds = new Set<string>();

  return sourcePolls.flatMap((poll, pollIndex) => {
    const messageId = cleanString(poll?.messageId);
    if (messageId && seenMessageIds.has(messageId)) return [];
    if (messageId) seenMessageIds.add(messageId);
    const options = [...new Set((Array.isArray(poll?.options) ? poll.options : [])
      .map(cleanString).filter(Boolean))];
    const validOptions = new Set(options);
    const votesByMember = new Map<string, OrderedParticipant>();

    if (poll?.votesAvailable && Array.isArray(poll.votes)) {
      poll.votes.forEach((vote, voteIndex) => {
        const voterId = normalizeWhatsAppId(vote?.voterId) || '';
        if (!voterId) return;
        const candidate: OrderedParticipant = {
          userId: voterId,
          name: displayName(vote?.voterName || vote?.name, voterId),
          selectedOptions: [...new Set((Array.isArray(vote?.selectedOptions)
            ? vote.selectedOptions : []).map(cleanString).filter((name) => validOptions.has(name)))],
          voteTimestamp: validTimestamp(vote?.voteTimestamp ?? vote?.timestamp),
          order: voteIndex
        };
        const previous = votesByMember.get(voterId);
        if (!previous || isLaterVote(candidate, previous)) votesByMember.set(voterId, candidate);
      });
    }

    const participants = [...votesByMember.values()]
      .filter((participant) => participant.selectedOptions.length > 0)
      .map(({ order: _order, ...participant }) => participant);
    const creator = normalizeCreator(poll);
    return [{
      id: messageId || `poll-${pollIndex}`,
      question: cleanString(poll?.question) || 'Enquete sem pergunta disponível',
      timestamp: validTimestamp(poll?.timestamp),
      options,
      votesAvailable: poll?.votesAvailable === true,
      participants,
      votes: participants.map((participant) => ({
        voterId: participant.userId,
        voterName: participant.name,
        selectedOptions: participant.selectedOptions,
        timestamp: participant.voteTimestamp
      })),
      ...creator
    }];
  });
}

function normalizeCreator(poll: RawPoll): Pick<PollAnalysis, 'creatorId' | 'creatorName'> {
  const explicitId = normalizeWhatsAppId(poll?.creatorId)
    || normalizeWhatsAppId(poll?.authorId)
    || normalizeWhatsAppId(poll?.author);
  const contextualId = normalizeWhatsAppId(poll?.participant)
    || normalizeWhatsAppId(poll?.from);
  const candidateId = explicitId || (contextualId?.endsWith('@g.us') ? null : contextualId);
  if (!candidateId || candidateId.endsWith('@g.us')) return { creatorId: null, creatorName: null };
  return {
    creatorId: candidateId,
    creatorName: displayName(
      poll?.creatorName || poll?.authorName || poll?.participantName || poll?.fromName,
      candidateId
    )
  };
}

function isLaterVote(candidate: OrderedParticipant, previous: OrderedParticipant): boolean {
  if (candidate.voteTimestamp !== null && previous.voteTimestamp !== null) {
    return candidate.voteTimestamp >= previous.voteTimestamp;
  }
  if (candidate.voteTimestamp !== null && previous.voteTimestamp === null) return true;
  if (candidate.voteTimestamp === null && previous.voteTimestamp !== null) return false;
  return candidate.order >= previous.order;
}

export function normalizeWhatsAppId(value: unknown): string | null {
  if (typeof value === 'string') return cleanString(value) || null;
  if (!isRecord(value)) return null;
  if (typeof value._serialized === 'string') return cleanString(value._serialized) || null;
  const stringified = typeof value.toString === 'function' ? value.toString() : undefined;
  return typeof stringified === 'string' && stringified !== '[object Object]'
    ? cleanString(stringified) || null
    : null;
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

export function normalizePollOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((option) => cleanText(
    typeof option === 'string' ? option : isRecord(option) ? option.name : undefined,
    200
  )).filter((option): option is string => Boolean(option));
}

export function normalizeVoteTimestamp(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

function validTimestamp(value: unknown): number | null {
  const timestamp = normalizeVoteTimestamp(value);
  return timestamp !== null && Number.isFinite(new Date(timestamp * 1000).getTime())
    ? timestamp
    : null;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function maskWhatsAppId(value: unknown): string {
  const id = cleanString(value);
  if (!id) return 'Participante não identificado';
  const number = id.split('@')[0];
  return `••••${number.length <= 4 ? number : number.slice(-4)}`;
}

function displayName(name: unknown, id: unknown): string {
  return cleanString(name) || maskWhatsAppId(id);
}

function resolveKnownName(id: string | null, namesById: Map<string, string>): string | null {
  if (!id) return null;
  return namesById.get(id) || null;
}

function isRecord(value: unknown): value is Record<string, unknown> & SerializedIdLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
