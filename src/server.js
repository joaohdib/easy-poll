'use strict';

const path = require('path');
const express = require('express');
const { WhatsAppService } = require('./whatsapp');

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

    return response.json(await whatsapp.getGroupMembers(groupId, 12));
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

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'Endpoint não encontrado.' });
});

app.use((error, _request, response, _next) => {
  const knownErrors = {
    WHATSAPP_NOT_CONNECTED: 503,
    GROUP_NOT_FOUND: 404,
    GROUP_MEMBERS_UNAVAILABLE: 504
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

module.exports = { app, validatePoll };
