import path from 'node:path';
import QRCode from 'qrcode';
import WhatsAppWeb = require('whatsapp-web.js');
import type { Chat as ChatInstance, Message } from 'whatsapp-web.js';
import type { Group, Member, SendPollInput } from '../domain/types';

const { Client, LocalAuth, Poll } = WhatsAppWeb;
const ChatConstructor = (WhatsAppWeb as unknown as {
  Chat: new (client: InstanceType<typeof Client>, data: Record<string, unknown>) => ChatInstance;
}).Chat;
const MessageConstructor = (WhatsAppWeb as unknown as {
  Message: new (client: InstanceType<typeof Client>, data: Record<string, unknown>) => Message;
}).Message;

declare global {
  interface Window {
    // Compatibility boundary: these internal WhatsApp Web APIs are dynamic and
    // are intentionally limited to code executed inside Puppeteer.
    require(moduleName: string): any;
    WWebJS: any;
  }
}

interface CodedError extends Error {
  code?: string;
}

interface BrowserMember {
  id: unknown;
  name: unknown;
  numberHint: string | null;
}

interface BrowserMembersResult {
  members: BrowserMember[];
  totalMembers: number;
  updateTimedOut: boolean;
}

interface BrowserId {
  _serialized?: string;
  server?: string;
  toString?: () => string;
}

interface BrowserChat {
  id?: BrowserId;
  groupMetadata?: unknown;
  formattedTitle?: string;
  name?: string;
}

interface BrowserParticipant {
  id?: BrowserId;
}

interface BrowserPollVote {
  sender?: string | BrowserId;
  selectedOptionLocalIds?: Iterable<number>;
  senderTimestampMs?: unknown;
}

interface BrowserPollMessage {
  id?: { id?: unknown; _serialized?: string; toString?: () => string };
}

interface SerializedPollId {
  localId: string;
  serialized: string;
}

interface LoadedMessageModel {
  model: Record<string, unknown>;
  serializedId: string | null;
}

interface PollOptionLike {
  name?: unknown;
  localId?: unknown;
}

export type PollMessage = Omit<Message, 'id' | 'pollOptions'> & {
  id: { id?: unknown; _serialized?: string; toString?: () => string };
  pollOptions: Array<string | PollOptionLike>;
  participant?: unknown;
};

export interface RecoveredVote {
  voterId: string | null;
  selectedOptionIds: unknown[];
  selectedOptions: string[];
  timestamp: number | null;
}

const INITIALIZATION_MAX_RETRIES = 2;
const INITIALIZATION_RETRY_DELAY_MS = 1500;

const CONNECTION_STATUS = Object.freeze({
  DISCONNECTED: 'disconnected',
  WAITING_QR: 'waiting_qr',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  AUTH_FAILURE: 'auth_failure'
});

class WhatsAppService {
  status: typeof CONNECTION_STATUS[keyof typeof CONNECTION_STATUS];
  qrDataUrl: string | null;
  lastError: string | null;
  initialized: boolean;
  clientGeneration: number;
  initializationRetryCount: number;
  initializationRetryTimer: ReturnType<typeof setTimeout> | null;
  connectionLostListeners: Set<() => void>;
  readyClient: InstanceType<typeof Client> | null;
  client!: InstanceType<typeof Client>;

  constructor() {
    this.status = CONNECTION_STATUS.CONNECTING;
    this.qrDataUrl = null;
    this.lastError = null;
    this.initialized = false;
    this.clientGeneration = 0;
    this.initializationRetryCount = 0;
    this.initializationRetryTimer = null;
    this.connectionLostListeners = new Set();
    this.readyClient = null;
    this.createClient();
  }

  createClient(): void {
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), '.wwebjs_auth')
      }),
      puppeteer: {
        headless: true,
        args: process.env.PUPPETEER_NO_SANDBOX === '1'
          ? ['--no-sandbox', '--disable-setuid-sandbox']
          : []
      }
    });
    this.readyClient = null;
    this.client = client;
    this.clientGeneration += 1;
    this.registerEvents(client, this.clientGeneration);
  }

  registerEvents(client: InstanceType<typeof Client>, generation: number): void {
    const isCurrentClient = () => this.client === client && this.clientGeneration === generation;

    client.on('qr', async (qr: string) => {
      if (!isCurrentClient()) return;
      this.status = CONNECTION_STATUS.WAITING_QR;
      this.lastError = null;

      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 320
        });
        if (isCurrentClient()) this.qrDataUrl = qrDataUrl;
      } catch (error) {
        if (!isCurrentClient()) return;
        this.qrDataUrl = null;
        this.lastError = 'Não foi possível gerar a imagem do QR Code.';
        console.error('[WhatsApp] Erro ao gerar QR Code:', getErrorMessage(error));
      }
    });

    client.on('authenticated', () => {
      if (!isCurrentClient()) return;
      this.status = CONNECTION_STATUS.CONNECTING;
      this.qrDataUrl = null;
      this.lastError = null;
      console.log('[WhatsApp] Sessão autenticada. Aguardando ficar pronta...');
    });

    client.on('ready', () => {
      if (!isCurrentClient()) return;
      this.initializationRetryCount = 0;
      this.readyClient = client;
      this.status = CONNECTION_STATUS.CONNECTED;
      this.qrDataUrl = null;
      this.lastError = null;
      console.log('[WhatsApp] Cliente conectado e pronto.');
    });

    client.on('auth_failure', (message: string) => {
      if (!isCurrentClient()) return;
      this.readyClient = null;
      this.notifyConnectionLost();
      this.status = CONNECTION_STATUS.AUTH_FAILURE;
      this.qrDataUrl = null;
      this.lastError = 'Falha ao autenticar a sessão do WhatsApp.';
      console.error('[WhatsApp] Falha de autenticação:', message);
    });

    client.on('disconnected', (reason: string) => {
      if (!isCurrentClient()) return;
      this.readyClient = null;
      this.notifyConnectionLost();
      this.status = CONNECTION_STATUS.DISCONNECTED;
      this.qrDataUrl = null;
      this.lastError = `WhatsApp desconectado${reason ? `: ${reason}` : '.'}`;
      console.warn('[WhatsApp] Desconectado:', reason);
    });

    client.on('change_state', (state: string) => {
      if (!isCurrentClient()) return;
      if (this.status !== CONNECTION_STATUS.CONNECTED) {
        this.status = CONNECTION_STATUS.CONNECTING;
      }
      console.log('[WhatsApp] Estado:', state);
    });
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.status = CONNECTION_STATUS.CONNECTING;

    const client = this.client;
    client.initialize().catch((error) => this.handleInitializationError(client, error));
  }

  async handleInitializationError(
    client: InstanceType<typeof Client>,
    error: unknown
  ): Promise<void> {
    if (this.client !== client) return;

    // whatsapp-web.js 1.34.7 emits `ready` from inject() before it finishes
    // exposing a few auxiliary browser callbacks. A late timeout from one of
    // those callbacks must not overwrite a client that already reached ready.
    // Real auth_failure/disconnected events update the status independently.
    if (this.readyClient === client) {
      this.status = CONNECTION_STATUS.CONNECTED;
      this.lastError = null;
      console.warn(
        '[WhatsApp] Inicialização terminou com erro após o cliente ficar pronto; mantendo a conexão:',
        getErrorMessage(error)
      );
      return;
    }

    if (isTransientInitializationError(error)
      && this.initializationRetryCount < INITIALIZATION_MAX_RETRIES) {
      this.initializationRetryCount += 1;
      const attempt = this.initializationRetryCount;
      this.status = CONNECTION_STATUS.CONNECTING;
      this.qrDataUrl = null;
      this.lastError = `O WhatsApp Web recarregou durante a conexão. Nova tentativa ${attempt}/${INITIALIZATION_MAX_RETRIES}…`;
      console.warn(`[WhatsApp] Inicialização interrompida por navegação. Tentando novamente (${attempt}/${INITIALIZATION_MAX_RETRIES})...`);

      try {
        await client.destroy();
      } catch (destroyError) {
        console.warn('[WhatsApp] Não foi possível encerrar completamente a tentativa anterior:', getErrorMessage(destroyError));
      }
      if (this.client !== client) return;

      this.initialized = false;
      this.createClient();
      this.initializationRetryTimer = setTimeout(() => {
        this.initializationRetryTimer = null;
        this.initialize();
      }, INITIALIZATION_RETRY_DELAY_MS);
      return;
    }

    this.status = CONNECTION_STATUS.DISCONNECTED;
    this.lastError = isTransientInitializationError(error)
      ? 'O WhatsApp Web recarregou repetidamente durante a conexão. Reinicie o EasyPoll e tente novamente.'
      : 'Não foi possível iniciar o WhatsApp Web.';
    console.error('[WhatsApp] Erro na inicialização:', error);
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === CONNECTION_STATUS.CONNECTED,
      hasQrCode: Boolean(this.qrDataUrl),
      error: this.lastError
    };
  }

  getQrCode(): string | null {
    return this.qrDataUrl;
  }

  onConnectionLost(listener: () => void): () => void {
    this.connectionLostListeners.add(listener);
    return () => this.connectionLostListeners.delete(listener);
  }

  notifyConnectionLost(): void {
    this.connectionLostListeners.forEach((listener) => listener());
  }

  getOwnIdentity(): { id: string | null; name: string | null } {
    return {
      id: this.client.info?.wid?._serialized || null,
      name: this.client.info?.pushname || null
    };
  }

  ensureConnected(): void {
    if (this.status !== CONNECTION_STATUS.CONNECTED) {
      const error = new Error('WhatsApp ainda não está conectado.') as CodedError;
      error.code = 'WHATSAPP_NOT_CONNECTED';
      throw error;
    }
  }

  async logout() {
    this.ensureConnected();
    this.readyClient = null;
    this.notifyConnectionLost();
    const client = this.client;
    this.status = CONNECTION_STATUS.CONNECTING;
    this.qrDataUrl = null;
    this.lastError = null;

    try {
      // logout() encerra o WhatsApp Web e o LocalAuth remove os dados da sessão.
      await client.logout();
    } catch (cause) {
      this.status = CONNECTION_STATUS.DISCONNECTED;
      this.lastError = 'Não foi possível desconectar a sessão do WhatsApp.';
      const error = new Error(this.lastError, { cause }) as CodedError;
      error.code = 'WHATSAPP_LOGOUT_FAILED';
      throw error;
    }

    this.initialized = false;
    this.createClient();
    this.initialize();
    return this.getStatus();
  }

  async getGroups(): Promise<Group[]> {
    this.ensureConnected();
    // getChats() serializa todos os tipos de conversa e pode falhar por causa
    // de um único chat incompatível. O MVP só precisa destes dois campos.
    const groups: Group[] = await this.client.pupPage.evaluate(() => {
      const chats: BrowserChat[] = window.require('WAWebCollections').Chat.getModelsArray();

      return chats.flatMap((chat: BrowserChat): Group[] => {
        try {
          const id = chat.id?._serialized || chat.id?.toString?.();
          const isGroup = Boolean(chat.groupMetadata)
            || chat.id?.server === 'g.us'
            || id?.endsWith('@g.us');

          if (!isGroup || !id) return [];
          return [{
            id,
            name: chat.formattedTitle || chat.name || 'Grupo sem nome'
          }];
        } catch (_error) {
          return [];
        }
      });
    });

    return [...new Map(groups.map((group) => [group.id, group])).values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async getGroupMembers(groupId: string): Promise<{ members: Member[]; totalMembers: number }> {
    this.ensureConnected();

    const groups = await this.getGroups();
    if (!groups.some((group) => group.id === groupId)) {
      const error = new Error('Grupo não encontrado.') as CodedError;
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    const result: BrowserMembersResult = await this.client.pupPage.evaluate(async (groupId) => {
      const WidFactory = window.require('WAWebWidFactory');
      const collections = window.require('WAWebCollections');
      const contactGetters = window.require('WAWebContactGetters');
      const groupWid = WidFactory.createWid(groupId);
      let chat = collections.Chat.get(groupWid)
        || await collections.Chat.find(groupWid);
      let participants: BrowserParticipant[] = chat?.groupMetadata?.participants?.serialize?.() || [];
      let updateTimedOut = false;

      if (!participants.length) {
        const metadataCollection = collections.GroupMetadata
          || collections.WAWebGroupMetadataCollection;
        const updateResult = await Promise.race([
          metadataCollection.update(groupWid)
            .then(() => 'updated')
            .catch(() => 'failed'),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 12000))
        ]);
        updateTimedOut = updateResult === 'timeout';
        chat = collections.Chat.get(groupWid) || chat;
        participants = chat?.groupMetadata?.participants?.serialize?.() || [];
      }

      const members = (await Promise.all(participants.map(async (
        participant: BrowserParticipant,
        index: number
      ): Promise<BrowserMember | null> => {
        try {
          const participantId = participant.id;
          const serializedId = participantId?._serialized || participantId?.toString?.();
          if (!serializedId) return null;
          const contact = collections.Contact.get(serializedId)
            || await collections.Contact.find(participantId).catch((): null => null);
          const digits = String(serializedId).split('@')[0].replace(/\D/g, '');
          // whatsapp-web.js 1.34.7 define pushname como o nome público
          // configurado pelo próprio contato. `name` é o nome salvo localmente.
          const name = (contact && (contactGetters.getPushname(contact)
            || contactGetters.getVerifiedName(contact)
            || contactGetters.getName(contact)
            || contactGetters.getShortName(contact)))
            || (digits ? `Contato •••• ${digits.slice(-4)}` : `Participante ${index + 1}`);

          return {
            id: serializedId,
            name: String(name),
            numberHint: digits ? `•••• ${digits.slice(-4)}` : null
          };
        } catch (_error) {
          return null;
        }
      }))).filter((member: BrowserMember | null): member is BrowserMember => member !== null);

      return { members, totalMembers: participants.length, updateTimedOut };
    }, groupId);

    if (!result.totalMembers) {
      const error = new Error(result.updateTimedOut
        ? 'A busca dos membros demorou demais. Tente novamente em alguns segundos.'
        : 'Não foi possível carregar os membros deste grupo. Tente atualizar os grupos e repetir.') as CodedError;
      error.code = 'GROUP_MEMBERS_UNAVAILABLE';
      throw error;
    }

    const members: Member[] = result.members.map((member, index) => ({
      id: String(member.id),
      name: String(member.name || `Participante ${index + 1}`).trim().slice(0, 100)
        || `Participante ${index + 1}`,
      numberHint: member.numberHint || null,
      profilePicUrl: null as string | null
    }));

    return { members, totalMembers: result.totalMembers };
  }

  async getGroupMemberProfilePic(
    groupId: string,
    memberId: string
  ): Promise<{ profilePicUrl: string | null }> {
    this.ensureConnected();

    const isMember = await this.client.pupPage.evaluate(({ groupId, memberId }) => {
      try {
        const WidFactory = window.require('WAWebWidFactory');
        const collections = window.require('WAWebCollections');
        const chat = collections.Chat.get(WidFactory.createWid(groupId));
        const participants: BrowserParticipant[] = chat?.groupMetadata?.participants?.serialize?.() || [];

        return participants.some((participant: BrowserParticipant) => {
          const id = participant.id?._serialized || participant.id?.toString?.();
          return id === memberId;
        });
      } catch (_error) {
        return false;
      }
    }, { groupId, memberId });

    if (!isMember) {
      const error = new Error('Membro não encontrado neste grupo.') as CodedError;
      error.code = 'GROUP_MEMBER_NOT_FOUND';
      throw error;
    }

    try {
      const profilePicUrl = await Promise.race([
        this.client.getProfilePicUrl(memberId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      return { profilePicUrl: profilePicUrl || null };
    } catch (_error) {
      // Ausência, privacidade e falhas pontuais de foto usam o avatar local.
      return { profilePicUrl: null };
    }
  }

  async sendPoll({ groupId, question, options, allowMultipleAnswers }: SendPollInput) {
    this.ensureConnected();

    const groups = await this.getGroups();
    if (!groups.some((group) => group.id === groupId)) {
      const error = new Error('Grupo não encontrado.') as CodedError;
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    const poll = new Poll(
      question,
      options,
      { allowMultipleAnswers } as WhatsAppWeb.PollSendOptions
    );
    // Algumas versões do WhatsApp Web removem a mensagem da coleção interna
    // antes de whatsapp-web.js montar o objeto de retorno. Nesse caso o envio
    // termina sem exceção, mas `message` vem undefined. waitUntilMsgSent faz a
    // rejeição real do envio propagar sem transformar esse retorno vazio em 502.
    const message = await this.client.sendMessage(groupId, poll, {
      waitUntilMsgSent: true
    });

    return { messageId: message?.id?._serialized || null };
  }

  async fetchGroupMessages(
    groupId: string,
    limit: number
  ): Promise<{ group: Group; messages: Message[] }> {
    const groups = await this.getGroups();
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) {
      const error = new Error('Grupo não encontrado.') as CodedError;
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    console.log(`[WhatsApp] Scanning up to ${limit} messages from group ${groupId}`);
    // Client#getChatById serializa o modelo completo do grupo antes de criar
    // Chat. Algumas versões atuais do WhatsApp Web falham nessa serialização
    // com uma exceção minificada (`r: r`). Chat#fetchMessages só precisa do ID
    // e internamente pede o modelo sem serializá-lo (`getAsModel: false`).
    const chat = new ChatConstructor(this.client, {
      id: { _serialized: groupId },
      formattedTitle: group.name,
      isGroup: true
    });
    let messages: Message[];
    try {
      messages = await chat.fetchMessages({ limit });
    } catch (cause) {
      console.error('[WhatsApp] fetchMessages failed during poll scan:', cause);
      const error = new Error(
        'O WhatsApp Web não conseguiu carregar o histórico disponível deste grupo.',
        { cause }
      ) as CodedError;
      error.code = 'POLL_MESSAGES_FETCH_FAILED';
      throw error;
    }
    return { group, messages };
  }

  async ensureGroupHistoryAnchor(groupId: string, messageId: string): Promise<boolean> {
    return this.client.pupPage.evaluate(async ({ chatId, messageId }) => {
      const collections = window.require('WAWebCollections');
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      let message = collections.Msg.get(messageId);
      const isInChat = () => chat?.msgs.getModelsArray().some((candidate: BrowserPollMessage) => {
        const candidateId = candidate.id?._serialized || candidate.id?.toString?.();
        return String(candidateId) === messageId;
      });
      if (!message || !isInChat()) {
        const result = await collections.Msg.getMessagesById([messageId]);
        message = result?.messages?.[0] || message;
      }
      if (!message || !chat) return false;
      const serialized = message.id?._serialized || message.id?.toString?.();
      const remote = message.id?.remote?._serialized
        || message.id?.remote?.toString?.()
        || message.id?.remote;
      if (String(serialized) !== messageId || String(remote) !== chatId) return false;
      return isInChat();
    }, { chatId: groupId, messageId });
  }

  async loadEarlierGroupMessages(
    groupId: string
  ): Promise<{ loadedMessages: number }> {
    return this.client.pupPage.evaluate(async (chatId) => {
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      const loader = window.require('WAWebChatLoadMessages');
      if (!loader || typeof loader.loadEarlierMsgs !== 'function') {
        throw new Error('WAWebChatLoadMessages.loadEarlierMsgs unavailable');
      }
      const loaded = await loader.loadEarlierMsgs({ chat });
      return { loadedMessages: Number(loaded?.length) || 0 };
    }, groupId);
  }

  async loadEarlierGroupMessagePage(
    groupId: string,
    timeoutMs = 30_000
  ): Promise<{ loadedMessages: number; messages: Message[] }> {
    const loaded = await this.client.pupPage.evaluate(async ({ chatId, timeoutMs }) => {
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      const loader = window.require('WAWebChatLoadMessages');
      if (!loader || typeof loader.loadEarlierMsgs !== 'function') {
        throw new Error('WAWebChatLoadMessages.loadEarlierMsgs unavailable');
      }
      const messages = await Promise.race([
        loader.loadEarlierMsgs({ chat }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('loadEarlierMsgs timeout')),
          timeoutMs
        ))
      ]);
      if (!Array.isArray(messages)) return [];
      return messages
        .filter((message) => !message.isNotification)
        .map((message): LoadedMessageModel => ({
          model: window.WWebJS.getMessageModel(message),
          serializedId: message.id?._serialized || message.id?.toString?.() || null
        }));
    }, { chatId: groupId, timeoutMs });

    const messages = loaded.map(({ model, serializedId }) => {
      const message = new MessageConstructor(this.client, model) as Message;
      if (serializedId && message.id && !message.id._serialized) {
        message.id._serialized = serializedId;
      }
      return message;
    });
    return { loadedMessages: messages.length, messages };
  }

  async countAvailableGroupMessages(groupId: string): Promise<number> {
    return this.client.pupPage.evaluate(async (chatId) => {
      const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
      return chat.msgs.getModelsArray().filter(
        (message: { isNotification?: boolean }) => !message.isNotification
      ).length;
    }, groupId);
  }

  async findGroup(groupId: string): Promise<Group> {
    const groups = await this.getGroups();
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) {
      const error = new Error('Grupo não encontrado.') as CodedError;
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }
    return group;
  }

  async getPollVotesForScan(
    messageId: string,
    pollOptions: Array<string | PollOptionLike>
  ): Promise<RecoveredVote[]> {
    // Client#getPollVotes() busca a mensagem novamente e envia o objeto Message
    // inteiro ao Puppeteer. No WhatsApp Web atual, `id._serialized` se perde
    // nessa segunda serialização. Esta consulta replica a implementação 1.34.7,
    // mas entrega diretamente a string do ID ao WAWebMsgKey.
    const rawVotes: Array<{
      voterId: string | null;
      selectedOptionIds: number[];
      timestamp: number | null;
    }> = await this.client.pupPage.evaluate(async (serializedMessageId) => {
      const messageKey = window.require('WAWebMsgKey').fromString(serializedMessageId);
      const votes = await window
        .require('WAWebPollsVotesSchema')
        .getTable()
        .equals(['parentMsgKey'], messageKey.toString());

      return votes.map((vote: BrowserPollVote) => {
        const sender = vote.sender;
        const voterId = typeof sender === 'string'
          ? sender
          : sender?._serialized || sender?.toString?.() || null;
        return {
          voterId: voterId && voterId !== '[object Object]' ? String(voterId) : null,
          selectedOptionIds: Array.from(new Uint8Array(vote.selectedOptionLocalIds || [])),
          timestamp: Number(vote.senderTimestampMs) || null
        };
      });
    }, messageId);

    const optionNamesById = new Map<string, string | null>();
    pollOptions.forEach((option) => {
      if (typeof option !== 'string' && option.localId !== undefined) {
        optionNamesById.set(String(option.localId), cleanText(option.name, 200));
      }
    });

    return rawVotes.map((vote) => ({
      voterId: vote.voterId,
      selectedOptionIds: Array.isArray(vote.selectedOptionIds) ? vote.selectedOptionIds : [],
      selectedOptions: (Array.isArray(vote.selectedOptionIds) ? vote.selectedOptionIds : [])
        .map((optionId) => optionNamesById.get(String(optionId)))
        .filter(Boolean),
      timestamp: vote.timestamp
    }));
  }

  async hydratePollMessageIds(groupId: string, pollMessages: PollMessage[]): Promise<void> {
    const messagesWithoutSerializedId = pollMessages.filter((message) => (
      !normalizeWhatsAppId(message.id) && message.id?.id !== undefined
    ));
    if (!messagesWithoutSerializedId.length) return;

    const localIds = [...new Set(messagesWithoutSerializedId.map((message) => String(message.id.id)))];
    let serializedIds: SerializedPollId[] = [];
    try {
      serializedIds = await this.client.pupPage.evaluate(async ({ groupId, localIds }) => {
        const chat = await window.WWebJS.getChat(groupId, { getAsModel: false });
        if (!chat) return [];
        const wantedIds = new Set(localIds);
        return chat.msgs.getModelsArray().flatMap(
          (message: BrowserPollMessage): SerializedPollId[] => {
          const localId = message.id?.id;
          if (localId === undefined || !wantedIds.has(String(localId))) return [];
          const serialized = message.id?._serialized || message.id?.toString?.();
          return serialized ? [{ localId: String(localId), serialized: String(serialized) }] : [];
          }
        );
      }, { groupId, localIds });
    } catch (error) {
      console.warn('[WhatsApp] Could not recover serialized poll message IDs:', getErrorMessage(error));
      return;
    }

    const serializedByLocalId = new Map<string, string>(
      serializedIds.map(({ localId, serialized }) => [localId, serialized])
    );
    let recovered = 0;
    messagesWithoutSerializedId.forEach((message) => {
      const serialized = serializedByLocalId.get(String(message.id.id));
      if (!serialized) return;
      message.id._serialized = serialized;
      recovered += 1;
    });
    console.log(`[WhatsApp] Recovered IDs for ${recovered}/${messagesWithoutSerializedId.length} poll messages`);
  }

  async shutdown(): Promise<void> {
    this.readyClient = null;
    this.notifyConnectionLost();
    if (this.initializationRetryTimer) {
      clearTimeout(this.initializationRetryTimer);
      this.initializationRetryTimer = null;
    }
    if (!this.initialized) return;
    try {
      await this.client.destroy();
    } catch (error) {
      console.error('[WhatsApp] Erro ao encerrar cliente:', getErrorMessage(error));
    }
  }
}

function normalizeWhatsAppId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  if (typeof value._serialized === 'string') return value._serialized;
  const stringified = typeof value.toString === 'function' ? value.toString() : undefined;
  return typeof stringified === 'string' && stringified !== '[object Object]'
    ? stringified
    : null;
}

function isTransientInitializationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLocaleLowerCase('en-US');
  return message.includes('execution context was destroyed')
    || message.includes('cannot find context with specified id')
    || message.includes('most likely because of a navigation');
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === 'string') return error.message;
  return error === null || error === undefined ? '' : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export {
  WhatsAppService,
  CONNECTION_STATUS,
  isTransientInitializationError
};
