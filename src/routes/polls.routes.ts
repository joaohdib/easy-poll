import { Router } from 'express';
import { normalizePollScan } from '../services/poll.service';
import type { HistoryService } from '../services/history.service';
import type { WhatsAppService } from '../services/whatsapp.service';
import type { AnalysisState } from './whatsapp.routes';
import {
  validateGroupId,
  validateHistoryPrepare,
  validateOlderSync,
  validatePoll,
  validatePollScan
} from './validation';

export function createPollsRouter(
  whatsapp: WhatsAppService,
  history: HistoryService,
  analysisState: AnalysisState
): Router {
  const router = Router();

  router.post('/polls', async (request, response, next) => {
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

  router.post('/groups/:groupId/polls/scan', async (request, response, next) => {
    try {
      const validation = validatePollScan(request.params.groupId, request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });

      response.set('Cache-Control', 'no-store');
      const scan = await history.scanGroupPolls(
        validation.value.groupId,
        validation.value.limit
      );
      analysisState.latestPollScan = normalizePollScan(scan);
      return response.json(scan);
    } catch (error) {
      return next(error);
    }
  });

  router.get('/groups/:groupId/history/status', async (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(await history.getGroupHistoryStatus(validation.value));
    } catch (error) {
      return next(error);
    }
  });

  router.get('/groups/:groupId/sync-status', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(history.getGroupSyncStatus(validation.value));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/groups/:groupId/sync/newer', async (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(await history.syncNewerMessages(validation.value));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/groups/:groupId/sync/older', async (request, response, next) => {
    try {
      const validation = validateOlderSync(request.params.groupId, request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(await history.syncOlderMessages(
        validation.value.groupId,
        validation.value.limit
      ));
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/groups/:groupId/sync', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(history.cancelIncrementalSync(validation.value));
    } catch (error) {
      return next(error);
    }
  });

  router.post('/groups/:groupId/history/prepare', async (request, response, next) => {
    try {
      const validation = validateHistoryPrepare(request.params.groupId, request.body);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      const status = await history.startGroupHistoryPreparation(
        validation.value.groupId,
        validation.value.target
      );
      return response.status(202).json(status);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/groups/:groupId/history/prepare', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      return response.json(history.cancelGroupHistoryPreparation(validation.value));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
