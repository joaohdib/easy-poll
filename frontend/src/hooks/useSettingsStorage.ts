import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type {
  DeleteAllDataResult,
  DeleteGroupDataResult,
  SettingsStorageSummary
} from '../types/api';

export function useSettingsStorage() {
  const [summary, setSummary] = useState<SettingsStorageSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState((current) => current === 'ready' ? 'ready' : 'loading');
    try {
      const result = await api.settingsStorage(request.signal);
      if (request.signal.aborted) return;
      setSummary(result);
      setState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState('error');
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  const deleteGroup = useCallback(async (groupId: string): Promise<DeleteGroupDataResult> => {
    const result = await api.deleteGroupData(groupId);
    await refresh();
    return result;
  }, [refresh]);

  const deleteAll = useCallback(async (): Promise<DeleteAllDataResult> => {
    const result = await api.deleteAllData();
    await refresh();
    return result;
  }, [refresh]);

  return { summary, state, refresh, deleteGroup, deleteAll };
}
