import { Router } from 'express';
import { calculatePollStats } from '../services/stats.service';
import type { StatsQueryService } from '../services/stats-query.service';
import { validateGroupId } from './validation';
import type { AnalysisState } from './whatsapp.routes';

export function createStatsRouter(
  analysisState: AnalysisState,
  statsQuery: StatsQueryService
): Router {
  const router = Router();

  router.get('/stats', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    if (!analysisState.latestPollScan) {
      return response.status(404).json({
        error: 'Ainda não há dados para analisar.',
        hasAnalysis: false
      });
    }
    return response.json({
      hasAnalysis: true,
      stats: calculatePollStats(analysisState.latestPollScan)
    });
  });

  router.get('/local/groups', (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      return response.json({ groups: statsQuery.listLocalGroups() });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/groups/:groupId/stats', (request, response, next) => {
    try {
      const validation = validateGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      response.set('Cache-Control', 'no-store');
      const result = statsQuery.getGroupStats(validation.value);
      if (!result) {
        return response.status(404).json({
          error: 'Grupo nÃ£o encontrado nos dados locais.'
        });
      }
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
