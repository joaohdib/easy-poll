import { Router } from 'express';
import type { PollAnalysisInput } from '../domain/types';
import type { WhatsAppService } from '../services/whatsapp.service';

export interface AnalysisState {
  latestPollScan: PollAnalysisInput | null;
}

export function createWhatsAppRouter(
  whatsapp: WhatsAppService,
  analysisState: AnalysisState
): Router {
  const router = Router();

  router.get('/status', (_request, response) => {
    response.json(whatsapp.getStatus());
  });

  router.get('/qr', (_request, response) => {
    const dataUrl = whatsapp.getQrCode();
    if (!dataUrl) {
      return response.status(404).json({ error: 'Nenhum QR Code disponível no momento.' });
    }
    return response.json({ dataUrl });
  });

  router.post('/whatsapp/logout', async (_request, response, next) => {
    try {
      const status = await whatsapp.logout();
      analysisState.latestPollScan = null;
      return response.json({
        success: true,
        message: 'WhatsApp desconectado. Escaneie o próximo QR Code para conectar novamente.',
        status
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
