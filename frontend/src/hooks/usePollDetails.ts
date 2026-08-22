import { useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { PollHistoryDetail } from '../types/api';

export function usePollDetails(groupId: string) {
  const [detail, setDetail] = useState<PollHistoryDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  async function open(messageId: string) {
    if (!groupId) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setDetail(null);
    setState('loading');
    dialog.current?.showModal();
    try {
      const result = await api.historyDetail(groupId, messageId, request.signal);
      if (request.signal.aborted) return;
      setDetail(result);
      setState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState('error');
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }

  function close() {
    if (dialog.current?.open) dialog.current.close();
    controller.current?.abort();
  }

  useEffect(() => {
    controller.current?.abort();
    setDetail(null);
  }, [groupId]);
  useEffect(() => () => controller.current?.abort(), []);

  return { close, detail, dialog, open, state };
}
