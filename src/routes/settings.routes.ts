import { Router } from 'express';
import type { SettingsService } from '../services/settings.service';

export const DELETE_ALL_CONFIRMATION = 'DELETE_ALL_LOCAL_DATA';

export function createSettingsRouter(settings: SettingsService): Router {
  const router = Router();

  router.get('/settings/storage', (_request, response, next) => {
    try {
      response.set('Cache-Control', 'no-store');
      return response.json(settings.getStorageSummary());
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/settings/groups/:groupId/data', (request, response, next) => {
    try {
      const validation = validateSettingsGroupId(request.params.groupId);
      if (validation.error) return response.status(400).json({ error: validation.error });
      if (!isRecord(request.body) || request.body.confirmGroupId !== validation.value) {
        return response.status(400).json({
          error: 'Confirmação inválida. Nenhum dado local foi removido.'
        });
      }
      const result = settings.deleteGroupData(validation.value);
      if (!result) {
        return response.status(404).json({ error: 'Grupo não encontrado nos dados locais.' });
      }
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/settings/data', (request, response, next) => {
    try {
      if (!isRecord(request.body) || request.body.confirm !== DELETE_ALL_CONFIRMATION) {
        return response.status(400).json({
          error: 'Confirmação inválida. Nenhum dado local foi removido.'
        });
      }
      return response.json(settings.deleteAllData());
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSettingsGroupId(value: unknown):
  | { value: string; error?: never }
  | { error: string; value?: never } {
  const groupId = typeof value === 'string' ? value.trim() : '';
  return groupId.endsWith('@g.us')
    ? { value: groupId }
    : { error: 'Selecione um grupo válido.' };
}
