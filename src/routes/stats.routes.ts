import { Router } from 'express';
import { calculatePollStats } from '../services/stats.service';
import type { AnalysisState } from './whatsapp.routes';

export function createStatsRouter(analysisState: AnalysisState): Router {
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

  return router;
}
