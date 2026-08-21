import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import {
  WhatsAppService,
  POLL_SCAN_DEFAULT_LIMIT,
  POLL_SCAN_MAX_LIMIT,
  HISTORY_PREPARE_DEFAULT_LIMIT,
  HISTORY_PREPARE_MAX_LIMIT
} from './whatsapp';
import { calculatePollStats, type PollScanInput } from './poll-stats';

type ValidationResult<T> =
  | { value: T; error?: never }
  | { error: string; value?: never };

interface PollPayload {
  groupId: string;
  question: string;
  options: string[];
  allowMultipleAnswers: boolean;
}

interface PollScanPayload {
  groupId: string;
  limit: number;
}

interface HistoryPreparePayload {
  groupId: string;
  target: number;
}

interface CodedError extends Error {
  code?: string;
}

const app = express();
const whatsapp = new WhatsAppService();
const port = Number(process.env.PORT) || 3000;
let latestPollScan: PollScanInput | null = null;

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/stats', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'stats.html'));
});

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
    latestPollScan = null;
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
    const scan = await whatsapp.scanGroupPolls(
      validation.value.groupId,
      validation.value.limit
    );
    latestPollScan = scan;
    return response.json(scan);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/stats', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  if (!latestPollScan) {
    return response.status(404).json({
      error: 'Ainda não há dados para analisar.',
      hasAnalysis: false
    });
  }
  return response.json({ hasAnalysis: true, stats: calculatePollStats(latestPollScan) });
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

const apiErrorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  const knownErrors: Record<string, number> = {
    WHATSAPP_NOT_CONNECTED: 503,
    GROUP_NOT_FOUND: 404,
    GROUP_MEMBERS_UNAVAILABLE: 504,
    GROUP_MEMBER_NOT_FOUND: 404,
    WHATSAPP_LOGOUT_FAILED: 502,
    POLL_SCAN_BUSY: 409,
    POLL_MESSAGES_FETCH_FAILED: 502,
    HISTORY_PREPARE_BUSY: 409
  };
  const codedError = toCodedError(error);
  const status = (codedError.code && knownErrors[codedError.code]) || 500;

  if (status === 500) console.error('[API] Erro inesperado:', codedError);
  response.status(status).json({
    error: status === 500 ? 'Erro ao processar a solicitação.' : codedError.message
  });
};
app.use(apiErrorHandler);

function validatePoll(body: unknown): ValidationResult<PollPayload> {
  if (!isRecord(body)) return { error: 'Corpo da solicitação inválido.' };

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

function validatePollScan(groupIdValue: unknown, body: unknown): ValidationResult<PollScanPayload> {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  if (!groupId.endsWith('@g.us')) return { error: 'Selecione um grupo válido.' };
  if (body !== undefined && !isRecord(body)) {
    return { error: 'Corpo da solicitação inválido.' };
  }

  const requestBody = isRecord(body) ? body : undefined;
  const rawLimit = requestBody?.limit ?? POLL_SCAN_DEFAULT_LIMIT;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > POLL_SCAN_MAX_LIMIT) {
    return { error: `O limite deve ser um número inteiro entre 1 e ${POLL_SCAN_MAX_LIMIT}.` };
  }
  return { value: { groupId, limit } };
}

function validateGroupId(groupIdValue: unknown): ValidationResult<string> {
  const groupId = typeof groupIdValue === 'string' ? groupIdValue.trim() : '';
  return groupId.endsWith('@g.us')
    ? { value: groupId }
    : { error: 'Selecione um grupo válido.' };
}

function validateHistoryPrepare(
  groupIdValue: unknown,
  body: unknown
): ValidationResult<HistoryPreparePayload> {
  const group = validateGroupId(groupIdValue);
  if ('error' in group) return { error: group.error };
  if (body !== undefined && !isRecord(body)) {
    return { error: 'Corpo da solicitação inválido.' };
  }
  const requestBody = isRecord(body) ? body : undefined;
  const target = Number(requestBody?.target ?? HISTORY_PREPARE_DEFAULT_LIMIT);
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
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nRecebido ${signal}. Encerrando...`);
  server.close();
  await whatsapp.shutdown();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toCodedError(error: unknown): CodedError {
  return error instanceof Error ? error as CodedError : new Error(String(error));
}

export { app, validatePoll, validatePollScan, validateHistoryPrepare };
