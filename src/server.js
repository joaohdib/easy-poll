'use strict';

const path = require('path');
const express = require('express');
const {
  WhatsAppService,
  POLL_SCAN_DEFAULT_LIMIT,
  POLL_SCAN_MAX_LIMIT,
  HISTORY_PREPARE_DEFAULT_LIMIT,
  HISTORY_PREPARE_MAX_LIMIT
} = require('./whatsapp');

const app = express();
const whatsapp = new WhatsAppService();
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/status', (_request, response) => {
  response.json(whatsapp.getStatus());
});

app.get('/api/qr', (_request, response) => {
  const dataUrl = whatsapp.getQrCode();
  if (!dataUrl) {
    return response.status(404).json({ error: 'Nenhum QR Code disponível no momento.' });
  }
  return response.json({ dataUrl });
});

app.get('/api/groups', async (_request, response, next) => {
  try {
    response.json({ groups: await whatsapp.getGroups() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/groups/:groupId/members', async (request, response, next) => {
  try {
    const groupId = request.params.groupId?.trim();
    if (!groupId?.endsWith('@g.us')) {
      return response.status(400).json({ error: 'Selecione um grupo válido.' });
    }

    return response.json(await whatsapp.getGroupMembers(groupId));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/groups/:groupId/members/:memberId/profile-picture', async (request, response, next) => {
  try {
    const groupId = request.params.groupId?.trim();
    const memberId = request.params.memberId?.trim();
    if (!groupId?.endsWith('@g.us') || !memberId || !/@(?:c\.us|lid)$/.test(memberId)) {
      return response.status(400).json({ error: 'Grupo ou membro inválido.' });
    }

    response.set('Cache-Control', 'no-store');
    return response.json(await whatsapp.getGroupMemberProfilePic(groupId, memberId));
  } catch (error) {
    return next(error);
  }
});

app.post('/api/whatsapp/logout', async (_request, response, next) => {
  try {
    const status = await whatsapp.logout();
    return response.json({
      success: true,
      message: 'WhatsApp desconectado. Escaneie o próximo QR Code para conectar novamente.',
      status
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/polls', async (request, response, next) => {
  try {
    const validation = validatePoll(request.body);
    if (validation.error) {
      return response.status(400).json({ error: validation.error });
    }

    const result = await whatsapp.sendPoll(validation.value);
    return response.status(201).json({
      success: true,
      message: 'Enquete enviada com sucesso.',
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/groups/:groupId/polls/scan', async (request, response, next) => {
  try {
    const validation = validatePollScan(request.params.groupId, request.body);
    if (validation.error) return response.status(400).json({ error: validation.error });

    response.set('Cache-Control', 'no-store');
    return response.json(await whatsapp.scanGroupPolls(
      validation.value.groupId,
      validation.value.limit
    ));
  } catch (error) {
    return next(error);
  }
});

app.get('/api/groups/:groupId/history/status', async (request, response, next) => {
  try {
    const validation = validateGroupId(request.params.groupId);
    if (validation.error) return response.status(400).json({ error: validation.error });
    response.set('Cache-Control', 'no-store');
    return response.json(await whatsapp.getGroupHistoryStatus(validation.value));
  } catch (error) {
    return next(error);
  }
});

app.post('/api/groups/:groupId/history/prepare', async (request, response, next) => {
  try {
    const validation = validateHistoryPrepare(request.params.groupId, request.body);
    if (validation.error) return response.status(400).json({ error: validation.error });
    response.set('Cache-Control', 'no-store');
    const status = await whatsapp.startGroupHistoryPreparation(
      validation.value.groupId,
      validation.value.target
    );
    return response.status(202).json(status);
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/groups/:groupId/history/prepare', (request, response, next) => {
  try {
    const validation = validateGroupId(request.params.groupId);
    if (validation.error) return response.status(400).json({ error: validation.error });
    response.set('Cache-Control', 'no-store');
    return response.json(whatsapp.cancelGroupHistoryPreparation(validation.value));
  } catch (error) {
    return next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Endpoint não encontrado.' });
});

app.use((error, _request, response, _next) => {
  const knownErrors = {
    WHATSAPP_NOT_CONNECTED: 503,
    GROUP_NOT_FOUND: 404,
    GROUP_MEMBERS_UNAVAILABLE: 504,
    GROUP_MEMBER_NOT_FOUND: 404,
    WHATSAPP_LOGOUT_FAILED: 502,
    POLL_SCAN_BUSY: 409,
    POLL_MESSAGES_FETCH_FAILED: 502,
    HISTORY_PREPARE_BUSY: 409
  };
  const status = knownErrors[error.code] || 500;

  if (status === 500) console.error('[API] Erro inesperado:', error);
  response.status(status).json({
    error: status === 500 ? 'Erro ao processar a solicitação.' : error.message
  });
});

function validatePoll(body) {
  if (!body || typeof body !== 'object') return { error: 'Corpo da solicitação inválido.' };

  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const options = Array.isArray(body.options)
    ? body.options.map((option) => (typeof option === 'string' ? option.trim() : ''))
    : [];

  if (!groupId || !groupId.endsWith('@g.us')) return { error: 'Selecione um grupo válido.' };
  if (!question) return { error: 'Digite a pergunta da enquete.' };
  if (question.length > 255) return { error: 'A pergunta deve ter no máximo 255 caracteres.' };
  if (options.length < 2) return { error: 'Informe pelo menos duas opções.' };
  if (options.length > 12) return { error: 'Uma enquete pode ter no máximo 12 opções.' };
  if (options.some((option) => !option)) return { error: 'As opções não podem ficar vazias.' };
  if (options.some((option) => option.length > 100)) return { error: 'Cada opção deve ter no máximo 100 caracteres.' };
  if (new Set(options.map((option) => option.toLocaleLowerCase('pt-BR'))).size !== options.length) {
    return { error: 'As opções da enquete devem ser diferentes.' };
  }
  if (typeof body.allowMultipleAnswers !== 'boolean') {
    return { error: 'A configuração de múltiplas respostas é inválida.' };
  }

  return {
    value: { groupId, question, options, allowMultipleAnswers: body.allowMultipleAnswers }
  };
}

function validatePollScan(groupIdValue, body) {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  if (!groupId.endsWith('@g.us')) return { error: 'Selecione um grupo válido.' };
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    return { error: 'Corpo da solicitação inválido.' };
  }

  const rawLimit = body?.limit ?? POLL_SCAN_DEFAULT_LIMIT;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > POLL_SCAN_MAX_LIMIT) {
    return { error: `O limite deve ser um número inteiro entre 1 e ${POLL_SCAN_MAX_LIMIT}.` };
  }
  return { value: { groupId, limit } };
}

function validateGroupId(groupIdValue) {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  return groupId.endsWith('@g.us')
    ? { value: groupId }
    : { error: 'Selecione um grupo válido.' };
}

function validateHistoryPrepare(groupIdValue, body) {
  const group = validateGroupId(groupIdValue);
  if (group.error) return group;
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body))) {
    return { error: 'Corpo da solicitação inválido.' };
  }
  const target = Number(body?.target ?? HISTORY_PREPARE_DEFAULT_LIMIT);
  if (!Number.isInteger(target) || target < 1 || target > HISTORY_PREPARE_MAX_LIMIT) {
    return { error: `O alvo deve ser um número inteiro entre 1 e ${HISTORY_PREPARE_MAX_LIMIT}.` };
  }
  return { value: { groupId: group.value, target } };
}

const server = app.listen(port, () => {
  console.log(`Aplicação disponível em http://localhost:${port}`);
  whatsapp.initialize();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nRecebido ${signal}. Encerrando...`);
  server.close();
  await whatsapp.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, validatePoll, validatePollScan, validateHistoryPrepare };
