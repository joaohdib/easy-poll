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
    this.clientGeneration = 0;
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
    client.initialize().catch((error) => {
      if (this.client !== client) return;
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
