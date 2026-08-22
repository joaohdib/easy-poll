import { Router } from 'express';
import type { HistoryQueryService } from '../services/history-query.service';
import { HistoryQueryValidationError } from '../services/history-query.service';
import { validateGroupId } from './validation';

export function createHistoryRouter(historyQuery: HistoryQueryService): Router {
  const router = Router();

  router.get('/groups/:groupId/history', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      const result = historyQuery.listGroupHistory(validation.value, request.query);
      if (!result) {
        return response.status(404).json({ error: 'Grupo não encontrado nos dados locais.' });
      }
      return response.json(result);
    } catch (error) {
      if (error instanceof HistoryQueryValidationError) {
        return response.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  router.get('/groups/:groupId/history/:messageId', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      const messageId = request.params.messageId?.trim();
      if (!messageId) return response.status(400).json({ error: 'Enquete inválida.' });
      response.set('Cache-Control', 'no-store');
      const result = historyQuery.getPollDetail(validation.value, messageId);
      if (!result) {
        return response.status(404).json({ error: 'Enquete não encontrada neste grupo.' });
      }
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
