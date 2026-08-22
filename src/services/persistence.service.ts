import type { EasyPollDatabase } from '../db/database';
import type {
  PersistablePoll,
  PersistablePollVote,
  PollScanPersistenceInput
} from '../domain/types';
import { GroupRepository } from '../repositories/group.repository';
import { MemberRepository, type MemberUpsert } from '../repositories/member.repository';
import {
  PollRepository,
  type PersistedVoteChoice
} from '../repositories/poll.repository';
import { ScanStateRepository } from '../repositories/scan-state.repository';
import type { PollOptionRecord } from '../db/schema';

export interface PersistenceSummary {
  pollsPersisted: number;
  votesReconciled: number;
  processedMessagesReceived: number;
  knownProcessedMessages: number;
}

interface VoteMappingResult {
  choices: PersistedVoteChoice[];
  error: string | null;
}

export class PersistenceService {
  readonly groups: GroupRepository;
  readonly members: MemberRepository;
  readonly polls: PollRepository;
  readonly scanState: ScanStateRepository;

  constructor(
    private readonly db: EasyPollDatabase,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000)
  ) {
    this.groups = new GroupRepository(db);
    this.members = new MemberRepository(db);
    this.polls = new PollRepository(db);
    this.scanState = new ScanStateRepository(db);
  }

  persistScan(input: PollScanPersistenceInput): PersistenceSummary {
    const summary = this.db.transaction(() => {
      this.groups.upsert(input.group);
      this.members.upsertMany(collectRelevantMembers(input.polls));

      let pollsPersisted = 0;
      let votesReconciled = 0;
      input.polls.forEach((snapshot) => {
        const poll = this.polls.upsertPoll(input.group.id, snapshot);
        if (!poll) {
          console.warn('[Persistence] Poll skipped because its stable message ID or timestamp is unavailable.');
          return;
        }

        const options = this.polls.reconcileOptions(poll.messageId, snapshot.options);
        pollsPersisted += 1;
        if (!snapshot.votesAvailable) return;

        const mapping = mapVoteSnapshot(snapshot, options);
        if (mapping.error) {
          console.warn(`[Persistence] Vote snapshot preserved because it could not be mapped safely: ${mapping.error}`);
          return;
        }
        this.polls.replaceVotes(poll.messageId, mapping.choices);
        votesReconciled += mapping.choices.length;
      });

      this.scanState.insertProcessedMessages(input.processedMessages);
      this.scanState.updateAfterScan(input.group.id, normalizeEpochSeconds(this.now())!);
      const knownProcessedMessages = this.scanState.countByGroup(input.group.id);
      return {
        pollsPersisted,
        votesReconciled,
        processedMessagesReceived: input.processedMessages.length,
        knownProcessedMessages
      };
    });
    // These logs run only after better-sqlite3 has committed the transaction.
    console.log(`[Persistence] Polls persisted: ${summary.pollsPersisted}`);
    console.log(`[Persistence] Votes reconciled: ${summary.votesReconciled}`);
    console.log(`[Persistence] Processed message metadata received: ${summary.processedMessagesReceived}`);
    console.log(`[Persistence] Known processed messages: ${summary.knownProcessedMessages}`);
    return summary;
  }
}

function collectRelevantMembers(polls: PersistablePoll[]): MemberUpsert[] {
  return polls.flatMap((poll) => [
    ...(poll.creatorId ? [{ id: poll.creatorId, displayName: poll.creatorName }] : []),
    ...poll.votes.flatMap((vote) => vote.voterId
      ? [{ id: vote.voterId, displayName: vote.voterName }]
      : [])
  ]);
}

function mapVoteSnapshot(
  poll: PersistablePoll,
  options: PollOptionRecord[]
): VoteMappingResult {
  const latestVotes = latestVoteByVoter(poll.votes);
  const choices: PersistedVoteChoice[] = [];

  for (const vote of latestVotes) {
    const hasSelections = vote.selectedOptionIds.length > 0 || vote.selectedOptions.length > 0;
    if (!vote.voterId) {
      if (hasSelections) return { choices: [], error: 'votante sem identificador estável' };
      continue;
    }

    const selectedOptionIds = new Set<number>();
    for (let index = 0; index < vote.selectedOptionIds.length; index += 1) {
      const localId = vote.selectedOptionIds[index];
      const option = findByLocalId(options, localId)
        || findByProvenPosition(options, localId)
        || findByUniqueText(options, vote.selectedOptions[index]);
      if (!option) {
        return { choices: [], error: 'opção selecionada sem correspondência inequívoca' };
      }
      selectedOptionIds.add(option.id);
    }

    for (let index = vote.selectedOptionIds.length; index < vote.selectedOptions.length; index += 1) {
      const option = findByUniqueText(options, vote.selectedOptions[index]);
      if (!option) {
        return { choices: [], error: 'texto de opção selecionada ambíguo ou desconhecido' };
      }
      selectedOptionIds.add(option.id);
    }

    selectedOptionIds.forEach((optionId) => choices.push({
      voterId: vote.voterId!,
      optionId,
      votedAt: normalizeEpochSeconds(vote.timestamp)
    }));
  }

  return { choices, error: null };
}

function latestVoteByVoter(votes: PersistablePollVote[]): PersistablePollVote[] {
  const latest = new Map<string, { vote: PersistablePollVote; order: number }>();
  votes.forEach((vote, order) => {
    if (!vote.voterId) {
      latest.set(`unknown:${order}`, { vote, order });
      return;
    }
    const previous = latest.get(vote.voterId);
    if (!previous || isLaterVote(vote, order, previous.vote, previous.order)) {
      latest.set(vote.voterId, { vote, order });
    }
  });
  return [...latest.values()].map(({ vote }) => vote);
}

function isLaterVote(
  candidate: PersistablePollVote,
  candidateOrder: number,
  previous: PersistablePollVote,
  previousOrder: number
): boolean {
  if (candidate.timestamp !== null && previous.timestamp !== null) {
    return candidate.timestamp >= previous.timestamp;
  }
  if (candidate.timestamp !== null) return true;
  if (previous.timestamp !== null) return false;
  return candidateOrder >= previousOrder;
}

function findByLocalId(options: PollOptionRecord[], localId: string) {
  return options.find((option) => option.whatsappLocalId === localId) || null;
}

function findByProvenPosition(options: PollOptionRecord[], localId: string) {
  const position = Number(localId);
  if (!Number.isInteger(position) || position < 0) return null;
  // whatsapp-web.js 1.34.7 creates local IDs from the option index. This is
  // used only when the serialized poll option itself omitted localId.
  return options.find((option) => (
    option.whatsappLocalId === null && option.position === position
  )) || null;
}

function findByUniqueText(options: PollOptionRecord[], text: string | undefined) {
  if (!text) return null;
  const matches = options.filter((option) => option.text === text);
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeEpochSeconds(value: unknown): number | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}
