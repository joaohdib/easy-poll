'use strict';

const path = require('path');
const QRCode = require('qrcode');
const { Chat, Client, LocalAuth, MessageTypes, Poll } = require('whatsapp-web.js');

const POLL_SCAN_DEFAULT_LIMIT = 1000;
const POLL_SCAN_MAX_LIMIT = 5000;
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
  constructor() {
    this.status = CONNECTION_STATUS.CONNECTING;
    this.qrDataUrl = null;
    this.lastError = null;
    this.initialized = false;
    this.clientGeneration = 0;
    this.pollScanInProgress = false;
    this.initializationRetryCount = 0;
    this.initializationRetryTimer = null;
    this.createClient();
  }

  createClient() {
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
    this.client = client;
    this.clientGeneration += 1;
    this.registerEvents(client, this.clientGeneration);
  }

  registerEvents(client, generation) {
    const isCurrentClient = () => this.client === client && this.clientGeneration === generation;

    client.on('qr', async (qr) => {
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
        console.error('[WhatsApp] Erro ao gerar QR Code:', error.message);
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
      this.status = CONNECTION_STATUS.CONNECTED;
      this.qrDataUrl = null;
      this.lastError = null;
      console.log('[WhatsApp] Cliente conectado e pronto.');
    });

    client.on('auth_failure', (message) => {
      if (!isCurrentClient()) return;
      this.status = CONNECTION_STATUS.AUTH_FAILURE;
      this.qrDataUrl = null;
      this.lastError = 'Falha ao autenticar a sessão do WhatsApp.';
      console.error('[WhatsApp] Falha de autenticação:', message);
    });

    client.on('disconnected', (reason) => {
      if (!isCurrentClient()) return;
      this.status = CONNECTION_STATUS.DISCONNECTED;
      this.qrDataUrl = null;
      this.lastError = `WhatsApp desconectado${reason ? `: ${reason}` : '.'}`;
      console.warn('[WhatsApp] Desconectado:', reason);
    });

    client.on('change_state', (state) => {
      if (!isCurrentClient()) return;
      if (this.status !== CONNECTION_STATUS.CONNECTED) {
        this.status = CONNECTION_STATUS.CONNECTING;
      }
      console.log('[WhatsApp] Estado:', state);
    });
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this.status = CONNECTION_STATUS.CONNECTING;

    const client = this.client;
    client.initialize().catch((error) => this.handleInitializationError(client, error));
  }

  async handleInitializationError(client, error) {
    if (this.client !== client) return;

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
        console.warn('[WhatsApp] Não foi possível encerrar completamente a tentativa anterior:', destroyError.message);
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

  getQrCode() {
    return this.qrDataUrl;
  }

  ensureConnected() {
    if (this.status !== CONNECTION_STATUS.CONNECTED) {
      const error = new Error('WhatsApp ainda não está conectado.');
      error.code = 'WHATSAPP_NOT_CONNECTED';
      throw error;
    }
  }

  async logout() {
    this.ensureConnected();
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
      const error = new Error(this.lastError, { cause });
      error.code = 'WHATSAPP_LOGOUT_FAILED';
      throw error;
    }

    this.initialized = false;
    this.createClient();
    this.initialize();
    return this.getStatus();
  }

  async getGroups() {
    this.ensureConnected();
    // getChats() serializa todos os tipos de conversa e pode falhar por causa
    // de um único chat incompatível. O MVP só precisa destes dois campos.
    const groups = await this.client.pupPage.evaluate(() => {
      const chats = window.require('WAWebCollections').Chat.getModelsArray();

      return chats.flatMap((chat) => {
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

  async getGroupMembers(groupId) {
    this.ensureConnected();

    const groups = await this.getGroups();
    if (!groups.some((group) => group.id === groupId)) {
      const error = new Error('Grupo não encontrado.');
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    const result = await this.client.pupPage.evaluate(async (groupId) => {
      const WidFactory = window.require('WAWebWidFactory');
      const collections = window.require('WAWebCollections');
      const contactGetters = window.require('WAWebContactGetters');
      const groupWid = WidFactory.createWid(groupId);
      let chat = collections.Chat.get(groupWid)
        || await collections.Chat.find(groupWid);
      let participants = chat?.groupMetadata?.participants?.serialize?.() || [];
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

      const members = (await Promise.all(participants.map(async (participant, index) => {
        try {
          const participantId = participant.id;
          const serializedId = participantId?._serialized || participantId?.toString?.();
          if (!serializedId) return null;
          const contact = collections.Contact.get(serializedId)
            || await collections.Contact.find(participantId).catch(() => null);
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
      }))).filter(Boolean);

      return { members, totalMembers: participants.length, updateTimedOut };
    }, groupId);

    if (!result.totalMembers) {
      const error = new Error(result.updateTimedOut
        ? 'A busca dos membros demorou demais. Tente novamente em alguns segundos.'
        : 'Não foi possível carregar os membros deste grupo. Tente atualizar os grupos e repetir.');
      error.code = 'GROUP_MEMBERS_UNAVAILABLE';
      throw error;
    }

    const members = result.members.map((member, index) => ({
      id: String(member.id),
      name: String(member.name || `Participante ${index + 1}`).trim().slice(0, 100)
        || `Participante ${index + 1}`,
      numberHint: member.numberHint || null,
      profilePicUrl: null
    }));

    return { members, totalMembers: result.totalMembers };
  }

  async getGroupMemberProfilePic(groupId, memberId) {
    this.ensureConnected();

    const isMember = await this.client.pupPage.evaluate(({ groupId, memberId }) => {
      try {
        const WidFactory = window.require('WAWebWidFactory');
        const collections = window.require('WAWebCollections');
        const chat = collections.Chat.get(WidFactory.createWid(groupId));
        const participants = chat?.groupMetadata?.participants?.serialize?.() || [];

        return participants.some((participant) => {
          const id = participant.id?._serialized || participant.id?.toString?.();
          return id === memberId;
        });
      } catch (_error) {
        return false;
      }
    }, { groupId, memberId });

    if (!isMember) {
      const error = new Error('Membro não encontrado neste grupo.');
      error.code = 'GROUP_MEMBER_NOT_FOUND';
      throw error;
    }

    try {
      const profilePicUrl = await Promise.race([
        this.client.getProfilePicUrl(memberId),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      return { profilePicUrl: profilePicUrl || null };
    } catch (_error) {
      // Ausência, privacidade e falhas pontuais de foto usam o avatar local.
      return { profilePicUrl: null };
    }
  }

  async sendPoll({ groupId, question, options, allowMultipleAnswers }) {
    this.ensureConnected();

    const groups = await this.getGroups();
    if (!groups.some((group) => group.id === groupId)) {
      const error = new Error('Grupo não encontrado.');
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    const poll = new Poll(question, options, { allowMultipleAnswers });
    // Algumas versões do WhatsApp Web removem a mensagem da coleção interna
    // antes de whatsapp-web.js montar o objeto de retorno. Nesse caso o envio
    // termina sem exceção, mas `message` vem undefined. waitUntilMsgSent faz a
    // rejeição real do envio propagar sem transformar esse retorno vazio em 502.
    const message = await this.client.sendMessage(groupId, poll, {
      waitUntilMsgSent: true
    });

    return { messageId: message?.id?._serialized || null };
  }

  async scanGroupPolls(groupId, limit = POLL_SCAN_DEFAULT_LIMIT) {
    this.ensureConnected();
    if (this.pollScanInProgress) {
      const error = new Error('Já existe uma análise de enquetes em andamento. Aguarde a conclusão.');
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

  async performGroupPollScan(groupId, limit) {
    const groups = await this.getGroups();
    const group = groups.find((candidate) => candidate.id === groupId);
    if (!group) {
      const error = new Error('Grupo não encontrado.');
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    console.log(`[WhatsApp] Scanning up to ${limit} messages from group ${groupId}`);
    // Client#getChatById serializa o modelo completo do grupo antes de criar
    // Chat. Algumas versões atuais do WhatsApp Web falham nessa serialização
    // com uma exceção minificada (`r: r`). Chat#fetchMessages só precisa do ID
    // e internamente pede o modelo sem serializá-lo (`getAsModel: false`).
    const chat = new Chat(this.client, {
      id: { _serialized: groupId },
      formattedTitle: group.name,
      isGroup: true
    });
    let messages;
    try {
      messages = await chat.fetchMessages({ limit });
    } catch (cause) {
      console.error('[WhatsApp] fetchMessages failed during poll scan:', cause);
      const error = new Error('O WhatsApp Web não conseguiu carregar o histórico disponível deste grupo.', { cause });
      error.code = 'POLL_MESSAGES_FETCH_FAILED';
      throw error;
    }
    const typeCounts = messages.reduce((counts, message) => {
      const type = String(message.type || 'unknown');
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    console.log('[WhatsApp] Types returned:', typeCounts);

    const pollMessages = messages.filter((message) => message.type === MessageTypes.POLL_CREATION);
    await this.hydratePollMessageIds(groupId, pollMessages);
    // Reaproveita a resolução de nomes já usada pelo seletor de membros.
    let members = [];
    if (pollMessages.length) {
      try {
        ({ members } = await this.getGroupMembers(groupId));
      } catch (error) {
        console.warn('[WhatsApp] Poll scan could not resolve group member names:', error.message);
      }
    }
    const namesById = new Map(members.map((member) => [member.id, member.name]));
    const ownId = this.client.info?.wid?._serialized || null;
    if (ownId && this.client.info?.pushname) namesById.set(ownId, this.client.info.pushname);

    const polls = [];
    let pollsWithVotesAvailable = 0;
    for (const message of pollMessages) {
      const authorId = normalizeWhatsAppId(message.author)
        || (message.fromMe ? ownId : normalizeWhatsAppId(message.from));
      const messageId = normalizeWhatsAppId(message.id);
      const poll = {
        messageId,
        question: cleanText(message.pollName, 500) || 'Enquete sem pergunta disponível',
        timestamp: Number(message.timestamp) || null,
        authorId,
        authorName: resolveKnownName(authorId, namesById),
        options: normalizePollOptions(message.pollOptions),
        allowMultipleAnswers: Boolean(message.allowMultipleAnswers),
        votes: [],
        voteCount: 0,
        votesAvailable: false,
        votesError: null
      };

      if (!messageId) {
        poll.votesError = 'O identificador desta enquete não foi disponibilizado pelo WhatsApp Web.';
        polls.push(poll);
        continue;
      }

      try {
        const votes = await this.getPollVotesForScan(messageId, message.pollOptions);
        poll.votes = votes.map((vote) => {
          const voterId = normalizeWhatsAppId(vote.voterId);
          return {
            voterId,
            voterName: resolveKnownName(voterId, namesById),
            selectedOptionIds: vote.selectedOptionIds,
            selectedOptions: vote.selectedOptions,
            timestamp: normalizeVoteTimestamp(vote.timestamp)
          };
        });
        poll.voteCount = poll.votes.length;
        poll.votesAvailable = true;
        pollsWithVotesAvailable += 1;
      } catch (error) {
        poll.votesError = cleanText(error?.message || error, 300)
          || 'O WhatsApp Web não disponibilizou os votos desta enquete.';
        console.warn(`[WhatsApp] Could not recover votes for poll ${poll.messageId || '(unknown id)'}: ${poll.votesError}`);
      }
      polls.push(poll);
    }

    console.log(`[WhatsApp] Found ${polls.length} poll messages`);
    console.log(`[WhatsApp] Votes recovered for ${pollsWithVotesAvailable}/${polls.length} polls`);
    return {
      group: { id: group.id, name: group.name },
      requestedLimit: limit,
      messagesScanned: messages.length,
      pollsFound: polls.length,
      pollsWithVotesAvailable,
      messageTypes: typeCounts,
      polls
    };
  }

  async getPollVotesForScan(messageId, pollOptions) {
    // Client#getPollVotes() busca a mensagem novamente e envia o objeto Message
    // inteiro ao Puppeteer. No WhatsApp Web atual, `id._serialized` se perde
    // nessa segunda serialização. Esta consulta replica a implementação 1.34.7,
    // mas entrega diretamente a string do ID ao WAWebMsgKey.
    const rawVotes = await this.client.pupPage.evaluate(async (serializedMessageId) => {
      const messageKey = window.require('WAWebMsgKey').fromString(serializedMessageId);
      const votes = await window
        .require('WAWebPollsVotesSchema')
        .getTable()
        .equals(['parentMsgKey'], messageKey.toString());

      return votes.map((vote) => {
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

    const optionNamesById = new Map((Array.isArray(pollOptions) ? pollOptions : [])
      .filter((option) => option && typeof option === 'object' && option.localId !== undefined)
      .map((option) => [String(option.localId), cleanText(option.name, 200)]));

    return rawVotes.map((vote) => ({
      voterId: vote.voterId,
      selectedOptionIds: Array.isArray(vote.selectedOptionIds) ? vote.selectedOptionIds : [],
      selectedOptions: (Array.isArray(vote.selectedOptionIds) ? vote.selectedOptionIds : [])
        .map((optionId) => optionNamesById.get(String(optionId)))
        .filter(Boolean),
      timestamp: vote.timestamp
    }));
  }

  async hydratePollMessageIds(groupId, pollMessages) {
    const messagesWithoutSerializedId = pollMessages.filter((message) => (
      !normalizeWhatsAppId(message.id) && message.id?.id !== undefined
    ));
    if (!messagesWithoutSerializedId.length) return;

    const localIds = [...new Set(messagesWithoutSerializedId.map((message) => String(message.id.id)))];
    let serializedIds = [];
    try {
      serializedIds = await this.client.pupPage.evaluate(async ({ groupId, localIds }) => {
        const chat = await window.WWebJS.getChat(groupId, { getAsModel: false });
        if (!chat) return [];
        const wantedIds = new Set(localIds);
        return chat.msgs.getModelsArray().flatMap((message) => {
          const localId = message.id?.id;
          if (localId === undefined || !wantedIds.has(String(localId))) return [];
          const serialized = message.id?._serialized || message.id?.toString?.();
          return serialized ? [{ localId: String(localId), serialized: String(serialized) }] : [];
        });
      }, { groupId, localIds });
    } catch (error) {
      console.warn('[WhatsApp] Could not recover serialized poll message IDs:', error.message);
      return;
    }

    const serializedByLocalId = new Map(serializedIds.map(({ localId, serialized }) => [localId, serialized]));
    let recovered = 0;
    messagesWithoutSerializedId.forEach((message) => {
      const serialized = serializedByLocalId.get(String(message.id.id));
      if (!serialized) return;
      message.id._serialized = serialized;
      recovered += 1;
    });
    console.log(`[WhatsApp] Recovered IDs for ${recovered}/${messagesWithoutSerializedId.length} poll messages`);
  }

  async shutdown() {
    if (this.initializationRetryTimer) {
      clearTimeout(this.initializationRetryTimer);
      this.initializationRetryTimer = null;
    }
    if (!this.initialized) return;
    try {
      await this.client.destroy();
    } catch (error) {
      console.error('[WhatsApp] Erro ao encerrar cliente:', error.message);
    }
  }
}

function normalizeWhatsAppId(value) {
  if (typeof value === 'string') return value;
  if (typeof value?._serialized === 'string') return value._serialized;
  const stringified = value?.toString?.();
  return typeof stringified === 'string' && stringified !== '[object Object]'
    ? stringified
    : null;
}

function isTransientInitializationError(error) {
  const message = String(error?.message || error || '').toLocaleLowerCase('en-US');
  return message.includes('execution context was destroyed')
    || message.includes('cannot find context with specified id')
    || message.includes('most likely because of a navigation');
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return null;
  return String(value).trim().slice(0, maxLength) || null;
}

function normalizePollOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => cleanText(
    typeof option === 'string' ? option : option?.name,
    200
  )).filter(Boolean);
}

function resolveKnownName(id, namesById) {
  if (!id) return null;
  return namesById.get(id) || null;
}

function normalizeVoteTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 10_000_000_000 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
}

module.exports = {
  WhatsAppService,
  CONNECTION_STATUS,
  POLL_SCAN_DEFAULT_LIMIT,
  POLL_SCAN_MAX_LIMIT,
  isTransientInitializationError
};
