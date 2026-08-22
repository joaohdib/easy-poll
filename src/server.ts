import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { closeDatabase, getDatabase, initializeDatabase } from './db';
import type { PollAnalysisInput } from './domain/types';
import { createGroupsRouter } from './routes/groups.routes';
import { createPollsRouter } from './routes/polls.routes';
import { createStatsRouter } from './routes/stats.routes';
import { createWhatsAppRouter } from './routes/whatsapp.routes';
import {
  validateHistoryPrepare,
  validatePoll,
  validatePollScan
} from './routes/validation';
import { HistoryService } from './services/history.service';
import { PersistenceService } from './services/persistence.service';
import { WhatsAppService } from './services/whatsapp.service';

interface CodedError extends Error {
  code?: string;
}

initializeLocalDatabase();

const app = express();
const whatsapp = new WhatsAppService();
const persistence = new PersistenceService(getDatabase());
const history = new HistoryService(whatsapp, persistence);
const analysisState: { latestPollScan: PollAnalysisInput | null } = {
  latestPollScan: null
};
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/stats', (_request, response) => {
  response.sendFile(path.join(__dirname, '..', 'public', 'stats.html'));
});

app.use('/api', createWhatsAppRouter(whatsapp, analysisState));
app.use('/api', createGroupsRouter(whatsapp));
app.use('/api', createPollsRouter(whatsapp, history, analysisState));
app.use('/api', createStatsRouter(analysisState));

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
  try {
    await whatsapp.shutdown();
  } finally {
    closeDatabase();
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function toCodedError(error: unknown): CodedError {
  return error instanceof Error ? error as CodedError : new Error(String(error));
}

function initializeLocalDatabase(): void {
  try {
    initializeDatabase();
    console.log('[Database] SQLite local migrado e disponível em data/easypoll.db');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Database] Falha ao inicializar o SQLite local: ${message}`);
    throw error;
  }
}

export {
  app,
  validatePoll,
  validatePollScan,
  validateHistoryPrepare
};
