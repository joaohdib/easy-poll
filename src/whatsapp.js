'use strict';

const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth, Poll } = require('whatsapp-web.js');

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

    this.client = new Client({
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

    this.registerEvents();
  }

  registerEvents() {
    this.client.on('qr', async (qr) => {
      this.status = CONNECTION_STATUS.WAITING_QR;
      this.lastError = null;

      try {
        this.qrDataUrl = await QRCode.toDataURL(qr, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 320
        });
      } catch (error) {
        this.qrDataUrl = null;
        this.lastError = 'Não foi possível gerar a imagem do QR Code.';
        console.error('[WhatsApp] Erro ao gerar QR Code:', error.message);
      }
    });

    this.client.on('authenticated', () => {
      this.status = CONNECTION_STATUS.CONNECTING;
      this.qrDataUrl = null;
      this.lastError = null;
      console.log('[WhatsApp] Sessão autenticada. Aguardando ficar pronta...');
    });

    this.client.on('ready', () => {
      this.status = CONNECTION_STATUS.CONNECTED;
      this.qrDataUrl = null;
      this.lastError = null;
      console.log('[WhatsApp] Cliente conectado e pronto.');
    });

    this.client.on('auth_failure', (message) => {
      this.status = CONNECTION_STATUS.AUTH_FAILURE;
      this.qrDataUrl = null;
      this.lastError = 'Falha ao autenticar a sessão do WhatsApp.';
      console.error('[WhatsApp] Falha de autenticação:', message);
    });

    this.client.on('disconnected', (reason) => {
      this.status = CONNECTION_STATUS.DISCONNECTED;
      this.qrDataUrl = null;
      this.lastError = `WhatsApp desconectado${reason ? `: ${reason}` : '.'}`;
      console.warn('[WhatsApp] Desconectado:', reason);
    });

    this.client.on('change_state', (state) => {
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

    this.client.initialize().catch((error) => {
      this.status = CONNECTION_STATUS.DISCONNECTED;
      this.lastError = 'Não foi possível iniciar o WhatsApp Web.';
      console.error('[WhatsApp] Erro na inicialização:', error);
    });
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

  async getGroupMembers(groupId, limit = 12) {
    this.ensureConnected();

    const groups = await this.getGroups();
    if (!groups.some((group) => group.id === groupId)) {
      const error = new Error('Grupo não encontrado.');
      error.code = 'GROUP_NOT_FOUND';
      throw error;
    }

    const result = await this.client.pupPage.evaluate(async ({ groupId, limit }) => {
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

      const names = await Promise.all(participants.slice(0, limit).map(async (participant, index) => {
        try {
          const participantId = participant.id;
          const serializedId = participantId?._serialized || participantId?.toString?.();
          const contact = collections.Contact.get(serializedId)
            || await collections.Contact.find(participantId).catch(() => null);

          if (!contact) return `Participante ${index + 1}`;
          return contactGetters.getName(contact)
            || contactGetters.getPushname(contact)
            || contactGetters.getShortName(contact)
            || contactGetters.getVerifiedName(contact)
            || `Participante ${index + 1}`;
        } catch (_error) {
          return `Participante ${index + 1}`;
        }
      }));

      return { names, totalMembers: participants.length, updateTimedOut };
    }, { groupId, limit });

    if (!result.totalMembers) {
      const error = new Error(result.updateTimedOut
        ? 'A busca dos membros demorou demais. Tente novamente em alguns segundos.'
        : 'Não foi possível carregar os membros deste grupo. Tente atualizar os grupos e repetir.');
      error.code = 'GROUP_MEMBERS_UNAVAILABLE';
      throw error;
    }

    const usedNames = new Set();
    const members = result.names.map((rawName, index) => {
      const baseName = String(rawName || `Participante ${index + 1}`).trim().slice(0, 94)
        || `Participante ${index + 1}`;
      let name = baseName;
      let suffix = 2;

      while (usedNames.has(name.toLocaleLowerCase('pt-BR'))) {
        name = `${baseName} (${suffix})`.slice(0, 100);
        suffix += 1;
      }
      usedNames.add(name.toLocaleLowerCase('pt-BR'));
      return name;
    });

    return { members, totalMembers: result.totalMembers };
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

  async shutdown() {
    if (!this.initialized) return;
    try {
      await this.client.destroy();
    } catch (error) {
      console.error('[WhatsApp] Erro ao encerrar cliente:', error.message);
    }
  }
}

module.exports = { WhatsAppService, CONNECTION_STATUS };
