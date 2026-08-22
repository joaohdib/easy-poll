import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import type { PollHistoryItem, PollHistoryPagination } from '../types/api';

const SEARCH_DEBOUNCE_MS = 350;

export function useHistory(groupId: string) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<PollHistoryItem[]>([]);
  const [pagination, setPagination] = useState<PollHistoryPagination | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  const parameters = useMemo(() => {
    const value = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (debouncedSearch) value.set('search', debouncedSearch);
    if (from) value.set('from', from);
    if (to) value.set('to', to);
    return value;
  }, [debouncedSearch, from, page, pageSize, to]);

  const loadHistory = useCallback(async () => {
    if (!groupId) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setState('loading');
    try {
      const result = await api.history(groupId, parameters, request.signal);
      if (request.signal.aborted) return;
      setItems(result.items);
      setPagination(result.pagination);
      setState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setItems([]);
      setPagination(null);
      setState('error');
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, [groupId, parameters]);

  useEffect(() => {
    controller.current?.abort();
    setPage(1);
    setItems([]);
    setPagination(null);
    setState(groupId ? 'loading' : 'idle');
  }, [groupId]);

  useEffect(() => {
    if (groupId) void loadHistory();
  }, [groupId, loadHistory]);

  useEffect(() => () => controller.current?.abort(), []);

  function resetPage(change: () => void) {
    change();
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setFrom('');
    setTo('');
    setPage(1);
  }

  return {
    clearFilters, from, hasFilters: Boolean(search.trim() || from || to), items,
    loadHistory, pageSize, pagination, search, setFrom,
    setPage, setPageSize, setSearch, setTo, state, to, resetPage
  };
}
