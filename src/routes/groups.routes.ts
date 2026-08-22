import { Router } from 'express';
import type { WhatsAppService } from '../services/whatsapp.service';

export function createGroupsRouter(whatsapp: WhatsAppService): Router {
  const router = Router();

  router.get('/groups', async (_request, response, next) => {
    try {
      response.json({ groups: await whatsapp.getGroups() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/groups/:groupId/members', async (request, response, next) => {
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

  router.get('/groups/:groupId/members/:memberId/profile-picture', async (
    request,
    response,
    next
  ) => {
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

  return router;
}
