import type {
  HistoryPreparationJob,
  HistoryPreparationStatus,
  Poll,
  PollScanPersistenceInput,
  PollScanResult,
  ProcessedMessageMetadata,
  SerializedHistoryPreparation
} from '../domain/types';
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
const HISTORY_PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const HISTORY_PREPARE_DELAY_MS = 15;
const HISTORY_PREPARE_STABLE_ATTEMPTS = 3;

interface CodedError extends Error {
  code?: string;
}

interface ScanPersistence {
  persistScan(input: PollScanPersistenceInput): unknown;
}

interface ProcessedMessageSource {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
}

export class HistoryService {
  pollScanInProgress = false;
  activeHistoryPreparation: HistoryPreparationJob | null = null;
  historyPreparationByGroup = new Map<string, HistoryPreparationJob>();
  historyPrepareTimeoutMs = HISTORY_PREPARE_TIMEOUT_MS;
  historyPrepareDelayMs = HISTORY_PREPARE_DELAY_MS;
  historyPrepareStableAttempts = HISTORY_PREPARE_STABLE_ATTEMPTS;

  constructor(
    readonly whatsapp: WhatsAppService,
    readonly persistence: ScanPersistence | null = null
  ) {
    whatsapp.onConnectionLost(() => this.cancelActiveHistoryPreparation('cancelled'));
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

    const pollMessages = messages.filter(
      (message) => message.type === 'poll_creation'
    ) as PollMessage[];
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

    const persistablePolls = polls.map((poll, index) => (
      createPersistablePoll(poll, pollMessages[index]?.pollOptions)
    ));
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return error === null || error === undefined ? '' : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
