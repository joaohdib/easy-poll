import type {
  Group,
  GroupSyncStatus,
  HistoryPreparationJob,
  HistoryPreparationStatus,
  IncrementalSyncDirection,
  IncrementalSyncResult,
  PersistablePoll,
  Poll,
  PollScanPersistenceInput,
  PollScanResult,
  ProcessedMessageMetadata,
  SerializedHistoryPreparation
} from '../domain/types';
import type { ProcessedMessageRecord } from '../db/schema';
import type { Message } from 'whatsapp-web.js';
import type { PersistenceSummary } from './persistence.service';
import {
  cleanText,
  createPersistablePoll,
  normalizeScannedPoll,
  normalizeVoteTimestamp,
  normalizeWhatsAppId
} from './poll.service';
import type { PollMessage, WhatsAppService } from './whatsapp.service';

export const POLL_SCAN_DEFAULT_LIMIT = 1000;
export const POLL_SCAN_MAX_LIMIT = 500_000;
export const HISTORY_PREPARE_DEFAULT_LIMIT = 1000;
export const HISTORY_PREPARE_MAX_LIMIT = 500_000;
export const NEWER_SYNC_INITIAL_LIMIT = 250;
export const NEWER_SYNC_MAX_LIMIT = 5000;
export const NEWER_SYNC_KNOWN_BOUNDARY_STREAK = 20;
export const NEWER_SYNC_KNOWN_POLL_LIMIT = 50;
export const OLDER_SYNC_DEFAULT_LIMIT = 1000;
export const OLDER_SYNC_MAX_LIMIT = 5000;
const HISTORY_PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const HISTORY_PREPARE_DELAY_MS = 15;
const HISTORY_PREPARE_STABLE_ATTEMPTS = 3;
const INCREMENTAL_SYNC_TIMEOUT_MS = 2 * 60 * 1000;
const OLDER_PAGE_TIMEOUT_MS = 30_000;
const OLDER_STABLE_ATTEMPTS = 3;

interface CodedError extends Error {
  code?: string;
}

interface ScanPersistence {
  persistScan(input: PollScanPersistenceInput): PersistenceSummary;
  getGroupSyncStatus(groupId: string): GroupSyncStatus;
  findProcessedIds(messageIds: string[]): Set<string>;
  getOldestProcessedMessage(groupId: string): ProcessedMessageRecord | null;
  getNewestProcessedMessage(groupId: string): ProcessedMessageRecord | null;
}

interface ProcessedMessageSource {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
}

interface ActiveIncrementalSync {
  token: symbol;
  groupId: string;
  direction: IncrementalSyncDirection;
  cancelRequested: boolean;
}

interface NormalizedPollBatch {
  polls: Poll[];
  persistablePolls: PersistablePoll[];
  pollsWithVotesAvailable: number;
}

export class HistoryService {
  pollScanInProgress = false;
  activeIncrementalSync: ActiveIncrementalSync | null = null;
  activeHistoryPreparation: HistoryPreparationJob | null = null;
  historyPreparationByGroup = new Map<string, HistoryPreparationJob>();
  historyPrepareTimeoutMs = HISTORY_PREPARE_TIMEOUT_MS;
  historyPrepareDelayMs = HISTORY_PREPARE_DELAY_MS;
  historyPrepareStableAttempts = HISTORY_PREPARE_STABLE_ATTEMPTS;
  incrementalSyncTimeoutMs = INCREMENTAL_SYNC_TIMEOUT_MS;
  olderPageTimeoutMs = OLDER_PAGE_TIMEOUT_MS;
  newerSyncInitialLimit = NEWER_SYNC_INITIAL_LIMIT;
  newerSyncMaxLimit = NEWER_SYNC_MAX_LIMIT;
  newerSyncKnownBoundaryStreak = NEWER_SYNC_KNOWN_BOUNDARY_STREAK;
  newerSyncKnownPollLimit = NEWER_SYNC_KNOWN_POLL_LIMIT;

  constructor(
    readonly whatsapp: WhatsAppService,
    readonly persistence: ScanPersistence | null = null
  ) {
    whatsapp.onConnectionLost(() => {
      this.cancelActiveHistoryPreparation('cancelled');
      if (this.activeIncrementalSync) this.activeIncrementalSync.cancelRequested = true;
    });
  }

  async scanGroupPolls(
    groupId: string,
    limit = POLL_SCAN_DEFAULT_LIMIT
  ): Promise<PollScanResult> {
    this.whatsapp.ensureConnected();
    if (this.activeHistoryPreparation) {
      const error = new Error('Aguarde a preparação do histórico terminar antes de analisar as enquetes.') as CodedError;
      error.code = 'HISTORY_PREPARE_BUSY';
      throw error;
    }
    if (this.activeIncrementalSync) {
      const error = new Error('Aguarde a sincronização incremental terminar antes de analisar as enquetes.') as CodedError;
      error.code = 'INCREMENTAL_SYNC_BUSY';
      throw error;
    }
    if (this.pollScanInProgress) {
      const error = new Error('Já existe uma análise de enquetes em andamento. Aguarde a conclusão.') as CodedError;
      error.code = 'POLL_SCAN_BUSY';
      throw error;
    }

    this.pollScanInProgress = true;
    try {
      return await this.performGroupPollScan(groupId, limit);
    } finally {
      this.pollScanInProgress = false;
    }
  }

  async performGroupPollScan(groupId: string, limit: number): Promise<PollScanResult> {
    const { group, messages } = await this.whatsapp.fetchGroupMessages(groupId, limit);
    const messageTypes = messages.reduce<Record<string, number>>((counts, message) => {
      const type = String(message.type || 'unknown');
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    console.log('[WhatsApp] Types returned:', messageTypes);

    const { polls, persistablePolls, pollsWithVotesAvailable } = await this.normalizePollBatch(
      groupId,
      messages.filter((message) => message.type === 'poll_creation') as PollMessage[]
    );
    console.log(`[WhatsApp] Found ${polls.length} poll messages`);
    console.log(`[WhatsApp] Votes recovered for ${pollsWithVotesAvailable}/${polls.length} polls`);
    const result: PollScanResult = {
      group,
      requestedLimit: limit,
      messagesScanned: messages.length,
      pollsFound: polls.length,
      pollsWithVotesAvailable,
      messageTypes,
      polls
    };
    if (this.persistence) {
      try {
        await this.persistence.persistScan({
          group,
          polls: persistablePolls,
          processedMessages: messages.flatMap((message) => {
            const metadata = createProcessedMessageMetadata(message, group.id);
            return metadata ? [metadata] : [];
          })
        });
      } catch (cause) {
        console.error('[Persistence] Scan transaction failed:', getErrorMessage(cause));
        const error = new Error(
          'O histórico foi analisado, mas não pôde ser salvo no banco local.',
          { cause }
        ) as CodedError;
        error.code = 'PERSISTENCE_FAILED';
        throw error;
      }
    }
    return result;
  }

  private async normalizePollBatch(
    groupId: string,
    pollMessages: PollMessage[]
  ): Promise<NormalizedPollBatch> {
    await this.whatsapp.hydratePollMessageIds(groupId, pollMessages);

    let members: Awaited<ReturnType<WhatsAppService['getGroupMembers']>>['members'] = [];
    if (pollMessages.length) {
      try {
        ({ members } = await this.whatsapp.getGroupMembers(groupId));
      } catch (error) {
        console.warn('[WhatsApp] Poll scan could not resolve group member names:', getErrorMessage(error));
      }
    }
    const namesById = new Map(members.map((member) => [member.id, member.name]));
    const ownIdentity = this.whatsapp.getOwnIdentity();
    if (ownIdentity.id && ownIdentity.name) namesById.set(ownIdentity.id, ownIdentity.name);

    const polls: Poll[] = [];
    let pollsWithVotesAvailable = 0;
    for (const message of pollMessages) {
      const messageId = normalizeWhatsAppId(message.id);
      if (!messageId) {
        polls.push(normalizeScannedPoll(
          message,
          namesById,
          ownIdentity.id,
          null,
          'O identificador desta enquete não foi disponibilizado pelo WhatsApp Web.'
        ));
        continue;
      }

      try {
        const votes = await this.whatsapp.getPollVotesForScan(messageId, message.pollOptions);
        polls.push(normalizeScannedPoll(message, namesById, ownIdentity.id, votes, null));
        pollsWithVotesAvailable += 1;
      } catch (error) {
        const votesError = cleanText(getErrorMessage(error), 300)
          || 'O WhatsApp Web não disponibilizou os votos desta enquete.';
        polls.push(normalizeScannedPoll(message, namesById, ownIdentity.id, null, votesError));
        console.warn(`[WhatsApp] Could not recover votes for poll ${messageId}: ${votesError}`);
      }
    }

    return {
      polls,
      pollsWithVotesAvailable,
      persistablePolls: polls.map((poll, index) => (
        createPersistablePoll(poll, pollMessages[index]?.pollOptions)
      ))
    };
  }

  getGroupSyncStatus(groupId: string): GroupSyncStatus {
    return this.requirePersistence().getGroupSyncStatus(groupId);
  }

  async syncNewerMessages(groupId: string): Promise<IncrementalSyncResult> {
    this.whatsapp.ensureConnected();
    const persistence = this.requirePersistence();
    const job = this.beginIncrementalSync(groupId, 'newer');

    try {
      const deadline = Date.now() + this.incrementalSyncTimeoutMs;
      const statusBefore = persistence.getGroupSyncStatus(groupId);
      this.requireIncrementalBaseline(statusBefore);
      const newest = persistence.getNewestProcessedMessage(groupId);
      let limit = this.newerSyncInitialLimit;
      let group: Group | null = null;
      let messages: Message[] = [];
      let knownIds = new Set<string>();
      let reachedBoundary = false;
      let operationTimedOut = false;

      while (!job.cancelRequested && Date.now() < deadline) {
        let fetched: Awaited<ReturnType<WhatsAppService['fetchGroupMessages']>>;
        try {
          fetched = await withTimeout(
            this.whatsapp.fetchGroupMessages(groupId, limit),
            Math.min(this.olderPageTimeoutMs, Math.max(1, deadline - Date.now()))
          );
        } catch (error) {
          if (!isIncrementalTimeout(error)) throw error;
          operationTimedOut = true;
          break;
        }
        group = fetched.group;
        messages = fetched.messages;
        const pollMessages = messages.filter(
          (message) => message.type === 'poll_creation'
        ) as PollMessage[];
        await this.whatsapp.hydratePollMessageIds(groupId, pollMessages);
        const ids = messages.flatMap((message) => {
          const id = normalizeWhatsAppId(message.id);
          return id ? [id] : [];
        });
        knownIds = persistence.findProcessedIds(ids);
        reachedBoundary = this.hasKnownNewerBoundary(
          messages,
          knownIds,
          newest?.messageId || null,
          statusBefore.messagesProcessed
        );
        if (reachedBoundary || messages.length < limit || limit >= this.newerSyncMaxLimit) break;
        limit = Math.min(limit * 2, this.newerSyncMaxLimit);
      }

      const cancelled = job.cancelRequested;
      const timedOut = !cancelled && (operationTimedOut || Date.now() >= deadline);
      const knownMessages = messages.filter((message) => {
        const id = normalizeWhatsAppId(message.id);
        return Boolean(id && knownIds.has(id));
      }).length;
      const unknownMessages = messages.filter((message) => {
        const id = normalizeWhatsAppId(message.id);
        return Boolean(id && !knownIds.has(id));
      });
      const processedMessages = unknownMessages.flatMap((message) => {
        const metadata = createProcessedMessageMetadata(message, groupId);
        return metadata ? [metadata] : [];
      });
      const boundaryNotFound = !cancelled && !timedOut && !reachedBoundary;

      if (cancelled || timedOut || boundaryNotFound || !group) {
        console.log(`[Sync:newer] group=${groupId} loaded=${messages.length} unknown=${processedMessages.length} known=${knownMessages} boundary=${reachedBoundary}`);
        return createIncrementalResult('newer', statusBefore, {
          messagesLoaded: messages.length,
          newMessages: processedMessages.length,
          knownMessages,
          reachedBoundary,
          boundaryNotFound,
          cancelled,
          timedOut
        });
      }

      const unknownIds = new Set(processedMessages.map((message) => message.id));
      const unknownPolls = messages.filter((message) => {
        const id = normalizeWhatsAppId(message.id);
        return message.type === 'poll_creation' && Boolean(id && unknownIds.has(id));
      }) as PollMessage[];
      const knownRecentPolls = messages.filter((message) => {
        const id = normalizeWhatsAppId(message.id);
        return message.type === 'poll_creation' && Boolean(id && knownIds.has(id));
      }).slice(-this.newerSyncKnownPollLimit) as PollMessage[];
      const pollMessages = uniqueMessagesById([...unknownPolls, ...knownRecentPolls]);
      const normalized = await this.normalizePollBatch(groupId, pollMessages);
      const summary = persistence.persistScan({
        group,
        polls: normalized.persistablePolls,
        processedMessages
      });
      const statusAfter = persistence.getGroupSyncStatus(groupId);
      console.log(`[Sync:newer] group=${groupId} loaded=${messages.length} unknown=${processedMessages.length} known=${knownMessages} polls=${pollMessages.length}`);
      return createIncrementalResult('newer', statusAfter, {
        messagesLoaded: messages.length,
        newMessages: processedMessages.length,
        knownMessages,
        messagesPersisted: statusAfter.messagesProcessed - statusBefore.messagesProcessed,
        pollsFound: pollMessages.length,
        pollsPersisted: summary.pollsPersisted,
        votesReconciled: summary.votesReconciled,
        reachedBoundary: true
      });
    } finally {
      this.finishIncrementalSync(job);
    }
  }

  async syncOlderMessages(
    groupId: string,
    limit = OLDER_SYNC_DEFAULT_LIMIT
  ): Promise<IncrementalSyncResult> {
    this.whatsapp.ensureConnected();
    const persistence = this.requirePersistence();
    const job = this.beginIncrementalSync(groupId, 'older');

    try {
      const deadline = Date.now() + this.incrementalSyncTimeoutMs;
      const statusBefore = persistence.getGroupSyncStatus(groupId);
      this.requireIncrementalBaseline(statusBefore);
      const group = await this.whatsapp.findGroup(groupId);
      const oldest = persistence.getOldestProcessedMessage(groupId);
      let anchorAvailable = false;
      try {
        anchorAvailable = Boolean(oldest && await withTimeout(
          this.whatsapp.ensureGroupHistoryAnchor(groupId, oldest.messageId),
          Math.min(this.olderPageTimeoutMs, Math.max(1, deadline - Date.now()))
        ));
      } catch (error) {
        if (!isIncrementalTimeout(error)) throw error;
        return createIncrementalResult('older', statusBefore, { timedOut: true });
      }
      if (!oldest || !anchorAvailable) {
        const error = new Error(
          'A fronteira mais antiga do histórico local não está disponível no WhatsApp Web nesta sessão.'
        ) as CodedError;
        error.code = 'OLDER_SYNC_BOUNDARY_UNAVAILABLE';
        throw error;
      }

      const selectedMessages: Message[] = [];
      const selectedMetadata: ProcessedMessageMetadata[] = [];
      const selectedIds = new Set<string>();
      const loadedIds = new Set<string>();
      let messagesLoaded = 0;
      let knownMessages = 0;
      let stableAttempts = 0;
      let reachedAvailableHistoryStart = false;
      let operationTimedOut = false;

      while (selectedMessages.length < limit && !job.cancelRequested && Date.now() < deadline) {
        const remainingMs = Math.max(1, deadline - Date.now());
        let page: Awaited<ReturnType<WhatsAppService['loadEarlierGroupMessagePage']>>;
        try {
          page = await this.whatsapp.loadEarlierGroupMessagePage(
            groupId,
            Math.min(this.olderPageTimeoutMs, remainingMs)
          );
        } catch (error) {
          if (!isIncrementalTimeout(error) && !getErrorMessage(error).includes('loadEarlierMsgs timeout')) {
            throw error;
          }
          operationTimedOut = true;
          break;
        }
        messagesLoaded += page.loadedMessages;
        if (!page.messages.length) {
          reachedAvailableHistoryStart = true;
          break;
        }
        const pollMessages = page.messages.filter(
          (message) => message.type === 'poll_creation'
        ) as PollMessage[];
        await this.whatsapp.hydratePollMessageIds(groupId, pollMessages);
        const pageIds = page.messages.flatMap((message) => {
          const id = normalizeWhatsAppId(message.id);
          return id ? [id] : [];
        });
        const knownIds = persistence.findProcessedIds(pageIds);
        knownMessages += pageIds.filter((id) => knownIds.has(id) || selectedIds.has(id)).length;
        const unseenLoaded = pageIds.filter((id) => !loadedIds.has(id));
        pageIds.forEach((id) => loadedIds.add(id));
        stableAttempts = unseenLoaded.length ? 0 : stableAttempts + 1;
        if (stableAttempts >= OLDER_STABLE_ATTEMPTS) {
          reachedAvailableHistoryStart = true;
          break;
        }

        const candidates = page.messages.flatMap((message) => {
          const metadata = createProcessedMessageMetadata(message, groupId);
          if (!metadata || knownIds.has(metadata.id) || selectedIds.has(metadata.id)) return [];
          return [{ message, metadata }];
        });
        const remaining = limit - selectedMessages.length;
        // loadEarlierMsgs returns an older page. When a page crosses the request
        // limit, keep the newest part so the persisted local interval stays contiguous.
        candidates.slice(-remaining).forEach(({ message, metadata }) => {
          selectedMessages.push(message);
          selectedMetadata.push(metadata);
          selectedIds.add(metadata.id);
        });
      }

      const cancelled = job.cancelRequested;
      const timedOut = !cancelled && (operationTimedOut || Date.now() >= deadline);
      if (cancelled || timedOut) {
        return createIncrementalResult('older', statusBefore, {
          messagesLoaded,
          newMessages: selectedMetadata.length,
          knownMessages,
          reachedBoundary: true,
          reachedAvailableHistoryStart,
          cancelled,
          timedOut
        });
      }

      const pollMessages = selectedMessages.filter(
        (message) => message.type === 'poll_creation'
      ) as PollMessage[];
      const normalized = await this.normalizePollBatch(groupId, pollMessages);
      const summary = persistence.persistScan({
        group,
        polls: normalized.persistablePolls,
        processedMessages: selectedMetadata
      });
      const statusAfter = persistence.getGroupSyncStatus(groupId);
      console.log(`[Sync:older] group=${groupId} loaded=${messagesLoaded} new=${selectedMetadata.length} oldest=${statusAfter.oldestProcessedTimestamp ?? 'none'}`);
      return createIncrementalResult('older', statusAfter, {
        messagesLoaded,
        newMessages: selectedMetadata.length,
        knownMessages,
        messagesPersisted: statusAfter.messagesProcessed - statusBefore.messagesProcessed,
        pollsFound: pollMessages.length,
        pollsPersisted: summary.pollsPersisted,
        votesReconciled: summary.votesReconciled,
        reachedBoundary: true,
        reachedAvailableHistoryStart
      });
    } finally {
      this.finishIncrementalSync(job);
    }
  }

  cancelIncrementalSync(groupId: string) {
    const job = this.activeIncrementalSync;
    if (job?.groupId === groupId) job.cancelRequested = true;
    return {
      groupId,
      direction: job?.groupId === groupId ? job.direction : null,
      cancelRequested: job?.groupId === groupId
    };
  }

  private hasKnownNewerBoundary(
    messages: Message[],
    knownIds: Set<string>,
    newestProcessedMessageId: string | null,
    messagesProcessed: number
  ): boolean {
    if (newestProcessedMessageId && messages.some(
      (message) => normalizeWhatsAppId(message.id) === newestProcessedMessageId
    )) return true;

    const requiredStreak = Math.min(this.newerSyncKnownBoundaryStreak, messagesProcessed);
    let oldestKnownStreak = 0;
    for (const message of messages) {
      const id = normalizeWhatsAppId(message.id);
      if (!id || !knownIds.has(id)) break;
      oldestKnownStreak += 1;
    }
    return requiredStreak > 0 && oldestKnownStreak >= requiredStreak;
  }

  private requireIncrementalBaseline(status: GroupSyncStatus): void {
    if (status.messagesProcessed > 0) return;
    const error = new Error(
      'Ainda não há histórico local para este grupo. Faça uma análise/importação inicial primeiro.'
    ) as CodedError;
    error.code = 'SYNC_BASELINE_REQUIRED';
    throw error;
  }

  private requirePersistence(): ScanPersistence {
    if (this.persistence) return this.persistence;
    const error = new Error('A persistência local não está disponível.') as CodedError;
    error.code = 'PERSISTENCE_UNAVAILABLE';
    throw error;
  }

  private beginIncrementalSync(
    groupId: string,
    direction: IncrementalSyncDirection
  ): ActiveIncrementalSync {
    if (this.pollScanInProgress || this.activeHistoryPreparation || this.activeIncrementalSync) {
      const error = new Error(
        'Já existe uma operação de histórico em andamento. Aguarde ou cancele antes de continuar.'
      ) as CodedError;
      error.code = 'INCREMENTAL_SYNC_BUSY';
      throw error;
    }
    const job = {
      token: Symbol(`incremental-${direction}`),
      groupId,
      direction,
      cancelRequested: false
    };
    this.activeIncrementalSync = job;
    return job;
  }

  private finishIncrementalSync(job: ActiveIncrementalSync): void {
    if (this.activeIncrementalSync?.token === job.token) this.activeIncrementalSync = null;
  }

  async getGroupHistoryStatus(groupId: string) {
    this.whatsapp.ensureConnected();
    const group = await this.whatsapp.findGroup(groupId);
    const saved = this.historyPreparationByGroup.get(groupId);
    if (saved) {
      if (saved.status !== 'preparing') {
        saved.messagesAvailable = await this.whatsapp.countAvailableGroupMessages(groupId);
        saved.updatedAt = new Date().toISOString();
      }
      return this.serializeHistoryPreparation(saved);
    }

    const messagesAvailable = await this.whatsapp.countAvailableGroupMessages(groupId);
    return {
      status: 'idle',
      groupId,
      messagesAvailable,
      initialMessagesAvailable: messagesAvailable,
      attempts: 0,
      noGrowthAttempts: 0,
      target: null as null,
      strategy: null as null,
      detail: 'Histórico disponível nesta sessão.',
      updatedAt: new Date().toISOString(),
      groupName: group.name
    };
  }

  async startGroupHistoryPreparation(groupId: string, target = HISTORY_PREPARE_DEFAULT_LIMIT) {
    this.whatsapp.ensureConnected();
    await this.whatsapp.findGroup(groupId);

    if (this.activeIncrementalSync) {
      const error = new Error('Aguarde a sincronização incremental terminar antes de preparar o histórico.') as CodedError;
      error.code = 'INCREMENTAL_SYNC_BUSY';
      throw error;
    }
    if (this.pollScanInProgress) {
      const error = new Error('Aguarde a análise de enquetes terminar antes de preparar o histórico.') as CodedError;
      error.code = 'POLL_SCAN_BUSY';
      throw error;
    }
    if (this.activeHistoryPreparation?.groupId === groupId) {
      const error = new Error('O histórico deste grupo já está sendo preparado.') as CodedError;
      error.code = 'HISTORY_PREPARE_BUSY';
      throw error;
    }
    if (this.activeHistoryPreparation) this.cancelActiveHistoryPreparation('cancelled');

    const initialMessagesAvailable = await this.whatsapp.countAvailableGroupMessages(groupId);
    const job: HistoryPreparationJob = {
      token: Symbol('history-preparation'),
      groupId,
      status: 'preparing',
      messagesAvailable: initialMessagesAvailable,
      initialMessagesAvailable,
      attempts: 0,
      noGrowthAttempts: 0,
      target,
      strategy: 'loadEarlierMsgs internal API (used by Chat#fetchMessages)',
      detail: 'Buscando mensagens anteriores…',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cancelRequested: false
    };
    this.activeHistoryPreparation = job;
    this.historyPreparationByGroup.set(groupId, job);
    console.log(`[HistorySync] group=${groupId}`);
    console.log(`[HistorySync] Initial available messages: ${initialMessagesAvailable}`);
    console.log(`[HistorySync] Strategy: ${job.strategy}`);
    this.runGroupHistoryPreparation(job).catch((error) => {
      console.error(`[HistorySync] Unexpected runner failure group=${groupId}:`, getErrorMessage(error));
    });
    return this.serializeHistoryPreparation(job);
  }

  async runGroupHistoryPreparation(job: HistoryPreparationJob): Promise<void> {
    const deadline = Date.now() + this.historyPrepareTimeoutMs;
    try {
      if (job.messagesAvailable >= job.target) {
        this.finishHistoryPreparation(job, 'completed', `Limite de ${job.target} mensagens atingido.`);
        return;
      }

      while (!job.cancelRequested && Date.now() < deadline) {
        job.attempts += 1;
        const before = job.messagesAvailable;
        const loadResult = await this.whatsapp.loadEarlierGroupMessages(job.groupId);
        if (job.cancelRequested || this.activeHistoryPreparation?.token !== job.token) break;

        await delay(this.historyPrepareDelayMs);
        if (job.cancelRequested || this.activeHistoryPreparation?.token !== job.token) break;

        job.messagesAvailable = await this.whatsapp.countAvailableGroupMessages(job.groupId);
        job.updatedAt = new Date().toISOString();
        const grew = job.messagesAvailable > before;
        job.noGrowthAttempts = grew ? 0 : job.noGrowthAttempts + 1;
        job.detail = grew
          ? `${job.messagesAvailable - before} novas mensagens ficaram disponíveis na última tentativa.`
          : `Sem novas mensagens após ${job.noGrowthAttempts} tentativa${job.noGrowthAttempts === 1 ? '' : 's'}.`;
        console.log(`[HistorySync] Attempt ${job.attempts}: ${job.messagesAvailable} (API returned ${loadResult.loadedMessages})`);

        if (job.messagesAvailable >= job.target) {
          this.finishHistoryPreparation(job, 'completed', `Limite de ${job.target} mensagens atingido.`);
          return;
        }
        if (job.noGrowthAttempts >= this.historyPrepareStableAttempts) {
          this.finishHistoryPreparation(
            job,
            'stabilized',
            `Sem novas mensagens após ${this.historyPrepareStableAttempts} tentativas.`
          );
          return;
        }
      }

      if (job.cancelRequested) {
        this.finishHistoryPreparation(job, 'cancelled', 'Preparação cancelada.');
      } else if (Date.now() >= deadline) {
        this.finishHistoryPreparation(job, 'timeout', 'O limite de tempo de 10 minutos foi atingido.');
      }
    } catch (cause) {
      if (job.cancelRequested) {
        this.finishHistoryPreparation(job, 'cancelled', 'Preparação cancelada.');
        return;
      }
      console.error(`[HistorySync] Failed group=${job.groupId}:`, getErrorMessage(cause));
      job.error = 'O WhatsApp Web não conseguiu carregar mensagens anteriores deste grupo.';
      this.finishHistoryPreparation(job, 'error', job.error);
    }
  }

  cancelGroupHistoryPreparation(groupId: string) {
    this.whatsapp.ensureConnected();
    const job = this.activeHistoryPreparation;
    if (job?.groupId === groupId) {
      job.cancelRequested = true;
      job.updatedAt = new Date().toISOString();
      job.detail = 'Cancelamento solicitado…';
      console.log(`[HistorySync] Cancellation requested group=${groupId}`);
      return this.serializeHistoryPreparation(job);
    }
    return this.serializeHistoryPreparation(this.historyPreparationByGroup.get(groupId)) || {
      status: 'idle',
      groupId,
      messagesAvailable: null as null,
      detail: 'Nenhuma preparação ativa para este grupo.'
    };
  }

  cancelActiveHistoryPreparation(status: HistoryPreparationStatus = 'cancelled'): void {
    const job = this.activeHistoryPreparation;
    if (!job) return;
    job.cancelRequested = true;
    this.finishHistoryPreparation(job, status, 'Preparação cancelada.');
  }

  finishHistoryPreparation(
    job: HistoryPreparationJob,
    status: HistoryPreparationStatus,
    detail: string
  ): void {
    if (job.status !== 'preparing') return;
    job.status = status;
    job.detail = detail;
    job.updatedAt = new Date().toISOString();
    job.finishedAt = job.updatedAt;
    if (this.activeHistoryPreparation?.token === job.token) this.activeHistoryPreparation = null;
    const label = status === 'stabilized' ? 'stabilized' : status;
    console.log(`[HistorySync] History ${label} at ${job.messagesAvailable} messages (group=${job.groupId})`);
  }

  serializeHistoryPreparation(
    job: HistoryPreparationJob | undefined | null
  ): SerializedHistoryPreparation | null {
    if (!job) return null;
    return {
      status: job.status,
      groupId: job.groupId,
      messagesAvailable: job.messagesAvailable,
      initialMessagesAvailable: job.initialMessagesAvailable,
      attempts: job.attempts,
      noGrowthAttempts: job.noGrowthAttempts,
      target: job.target,
      strategy: job.strategy,
      detail: job.detail,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt || null,
      error: job.error || null
    };
  }
}

function createIncrementalResult(
  direction: IncrementalSyncDirection,
  status: GroupSyncStatus,
  values: Partial<IncrementalSyncResult>
): IncrementalSyncResult {
  return {
    direction,
    messagesLoaded: 0,
    newMessages: 0,
    knownMessages: 0,
    messagesPersisted: 0,
    pollsFound: 0,
    pollsPersisted: 0,
    votesReconciled: 0,
    oldestProcessedTimestamp: status.oldestProcessedTimestamp,
    newestProcessedTimestamp: status.newestProcessedTimestamp,
    reachedBoundary: false,
    boundaryNotFound: false,
    reachedAvailableHistoryStart: false,
    cancelled: false,
    timedOut: false,
    ...values
  };
}

function uniqueMessagesById(messages: PollMessage[]): PollMessage[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    const id = normalizeWhatsAppId(message.id);
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function createProcessedMessageMetadata(
  message: ProcessedMessageSource,
  groupId: string
): ProcessedMessageMetadata | null {
  const id = normalizeWhatsAppId(message.id);
  const timestamp = normalizeVoteTimestamp(message.timestamp);
  if (!id || timestamp === null) return null;
  return {
    id,
    groupId,
    type: cleanText(message.type, 100) || 'unknown',
    timestamp
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Tempo limite da sincronização incremental atingido.') as CodedError;
      error.code = 'INCREMENTAL_SYNC_TIMEOUT';
      reject(error);
    }, milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isIncrementalTimeout(error: unknown): boolean {
  return isRecord(error) && error.code === 'INCREMENTAL_SYNC_TIMEOUT';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return error === null || error === undefined ? '' : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
