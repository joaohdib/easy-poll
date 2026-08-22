import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { ConnectionStatusName } from '../types/api';

export const WHATSAPP_STATUS_COPY: Record<ConnectionStatusName, [string, string]> = {
  disconnected: ['Desconectado', 'O WhatsApp está offline. Reinicie o servidor para reconectar.'],
  waiting_qr: ['Aguardando QR Code', 'Escaneie o código abaixo para conectar sua conta.'],
  connecting: ['Conectando', 'Preparando sua sessão do WhatsApp Web…'],
  connected: ['Conectado', 'Sua conta está pronta para enviar uma enquete.'],
  auth_failure: ['Falha na autenticação', 'Não foi possível autenticar. Reinicie o servidor e tente novamente.']
};

export function useWhatsAppStatus() {
  const [status, setStatus] = useState<ConnectionStatusName>('connecting');
  const [hint, setHint] = useState(WHATSAPP_STATUS_COPY.connecting[1]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const requestId = useRef(0);
  const statusValue = useRef(status);
  statusValue.current = status;

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const data = await api.status();
      if (currentRequest !== requestId.current) return;
      statusValue.current = data.status;
      setStatus(data.status);
      setHint(data.error || WHATSAPP_STATUS_COPY[data.status][1]);
      if (data.status === 'waiting_qr' && data.hasQrCode) {
        try {
          const qr = await api.qr();
          if (currentRequest === requestId.current && statusValue.current === 'waiting_qr') setQrDataUrl(qr.dataUrl);
        } catch {
          setQrDataUrl(null);
        }
      } else {
        setQrDataUrl(null);
      }
    } catch {
      if (currentRequest !== requestId.current) return;
      statusValue.current = 'disconnected';
      setStatus('disconnected');
      setHint('Não foi possível acessar o servidor local.');
      setQrDataUrl(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_500);
    return () => {
      window.clearInterval(interval);
      requestId.current += 1;
    };
  }, [refresh]);

  async function logout(): Promise<string> {
    setDisconnecting(true);
    try {
      const data = await api.logout();
      await refresh();
      return data.message || 'WhatsApp desconectado com sucesso.';
    } finally {
      setDisconnecting(false);
    }
  }

  return { connected: status === 'connected', disconnecting, hint, logout, qrDataUrl, status };
}
