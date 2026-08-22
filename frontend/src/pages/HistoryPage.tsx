import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import { BrandMark } from '../components/BrandMark';
import { Navigation } from '../components/Navigation';
import { Toast } from '../components/Toast';
import { useToast } from '../hooks/useToast';
import { usePageMetadata } from '../hooks/usePageMetadata';
import type {
  IncrementalSyncResult, LocalGroup, PollHistoryDetail, PollHistoryItem,
  PollHistoryPagination, SyncDirection
} from '../types/api';
import { errorMessage, formatTimestamp, numberFormatter, plural } from '../utils/format';
import { readStoredValue, STORAGE_KEYS, writeStoredValue } from '../utils/storage';

const SEARCH_DEBOUNCE_MS = 350;

export function HistoryPage() {
  usePageMetadata('Histórico — EasyPoll', 'Histórico local e persistente das enquetes do EasyPoll.');
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [groupsState, setGroupsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [oldest, setOldest] = useState<number | null>(null);
  const [syncFeedback, setSyncFeedback] = useState('Selecione um grupo para abrir o histórico local.');
  const [syncError, setSyncError] = useState(false);
  const [syncDirection, setSyncDirection] = useState<SyncDirection | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<PollHistoryItem[]>([]);
  const [pagination, setPagination] = useState<PollHistoryPagination | null>(null);
  const [listState, setListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detail, setDetail] = useState<PollHistoryDetail | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const browser = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  const { toast, showToast } = useToast();
  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;
  const hasFilters = Boolean(search.trim() || from || to);

  const loadGroups = useCallback(async (preserveCurrent = false) => {
    const payload = await api.localGroups();
    setGroups(payload.groups);
    if (preserveCurrent) return payload.groups;
    const requested = new URLSearchParams(window.location.search).get('groupId') || '';
    const stored = readStoredValue(STORAGE_KEYS.lastGroupId);
    const candidate = requested || stored;
    const selected = payload.groups.some((group) => group.id === candidate) ? candidate : '';
    setGroupId(selected);
    setGroupsState('ready');
    return payload.groups;
  }, []);

  useEffect(() => {
    void loadGroups().catch(() => {
      setGroupsState('error'); setSyncError(true);
      setSyncFeedback('Não foi possível carregar os grupos armazenados localmente.');
    });
  }, [loadGroups]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, SEARCH_DEBOUNCE_MS);
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
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState('loading');
    try {
      const result = await api.history(groupId, parameters, controller.signal);
      if (controller.signal.aborted) return;
      setItems(result.items); setPagination(result.pagination); setListState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setItems([]); setPagination(null); setListState('error');
    } finally { if (listController.current === controller) listController.current = null; }
  }, [groupId, parameters]);

  const loadSyncStatus = useCallback(async () => {
    if (!groupId) return;
    try {
      const status = await api.syncStatus(groupId);
      setLastSync(status.lastSyncAt); setOldest(status.oldestProcessedTimestamp);
    } catch { setLastSync(null); setOldest(null); }
  }, [groupId]);

  useEffect(() => {
    listController.current?.abort(); detailController.current?.abort();
    setPage(1); setItems([]); setPagination(null); setDetail(null);
    if (!groupId) {
      if (groupsState === 'ready') window.history.replaceState(null, '', '/history');
      setListState('idle'); setSyncFeedback(groups.length
        ? 'Selecione um grupo para abrir o histórico local.'
        : 'Nenhum grupo foi armazenado ainda. Analise ou sincronize um grupo na página principal.');
      return;
    }
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
    window.history.replaceState(null, '', `/history?groupId=${encodeURIComponent(groupId)}`);
    setSyncFeedback('Histórico carregado somente do SQLite local.'); setSyncError(false);
    if (!initialized.current) initialized.current = true;
    void loadSyncStatus();
  }, [groupId, groups.length, groupsState, loadSyncStatus]);

  useEffect(() => {
    if (!groupId || !initialized.current) return;
    void loadHistory();
  }, [loadHistory, groupId]);

  useEffect(() => () => { listController.current?.abort(); detailController.current?.abort(); }, []);

  function chooseGroup(value: string) { setGroupId(value); }
  function resetPage(change: () => void) { change(); setPage(1); }
  function clearFilters() { setSearch(''); setDebouncedSearch(''); setFrom(''); setTo(''); setPage(1); }

  async function openDetail(messageId: string) {
    if (!groupId) return;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetail(null); setDetailState('loading'); detailDialog.current?.showModal();
    try {
      const result = await api.historyDetail(groupId, messageId, controller.signal);
      if (controller.signal.aborted) return;
      setDetail(result); setDetailState('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDetailState('error');
    } finally { if (detailController.current === controller) detailController.current = null; }
  }
  function closeDetail() { detailDialog.current?.close(); detailController.current?.abort(); }

  async function refreshGroupMetadata() {
    try { await loadGroups(true); } catch { /* existing metadata stays visible */ }
  }
  async function runSync(direction: SyncDirection) {
    if (!groupId || syncDirection) return;
    const target = groupId;
    setSyncDirection(direction); setSyncError(false);
    setSyncFeedback(direction === 'newer' ? 'Sincronizando mensagens mais recentes...' : 'Buscando mensagens mais antigas disponíveis...');
    try {
      const result = await api.sync(target, direction);
      if (target !== groupId) return;
      if (direction === 'newer') setPage(1);
      const summary = syncSummary(result);
      setSyncFeedback(result.cancelled ? 'Sincronização cancelada.' : `✓ ${summary}`);
      showToast(result.cancelled ? 'Sincronização cancelada.' : summary);
      await Promise.all([loadSyncStatus(), loadHistory(), refreshGroupMetadata()]);
    } catch (error) {
      if (target !== groupId) return;
      const message = errorMessage(error); setSyncError(true); setSyncFeedback(message); showToast(message, true);
    } finally { if (target === groupId) setSyncDirection(null); }
  }
  async function cancelSync() {
    if (!groupId || !syncDirection) return;
    setCancelPending(true);
    try { await api.cancelSync(groupId); setSyncFeedback('Cancelamento solicitado...'); }
    catch (error) { showToast(errorMessage(error), true); }
    finally { setCancelPending(false); }
  }

  const emptyText = hasFilters
    ? 'Nenhuma enquete encontrada para esses filtros.'
    : 'Nenhuma enquete armazenada neste grupo. Analise ou sincronize o histórico para começar.';

  return (
    <main className="history-page-shell">
      <header className="stats-hero history-page-hero"><BrandMark variant="history" /><div><p className="eyebrow">Dados persistidos no SQLite</p><h1>Histórico</h1><p>Navegue pelas enquetes armazenadas sem reler conversas do WhatsApp.</p></div></header>
      <Navigation current="history" />
      <section className="card history-overview" aria-labelledby="history-group-title">
        <div className="history-group-picker"><div><p className="step">Dados locais</p><h2 id="history-group-title">Grupo armazenado</h2></div><label className="sr-only" htmlFor="history-group-select">Selecionar grupo armazenado</label><select id="history-group-select" value={groupId} disabled={Boolean(syncDirection) || groupsState === 'loading'} onChange={(event) => chooseGroup(event.target.value)}><option value="">{groupsState === 'loading' ? 'Carregando grupos locais...' : groupsState === 'error' ? 'Não foi possível carregar os grupos' : groups.length ? 'Selecione um grupo' : 'Nenhum grupo armazenado'}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} — {plural(group.pollCount, 'enquete', 'enquetes')}</option>)}</select></div>
        {selectedGroup && <div className="history-page-summary"><div><strong>{numberFormatter.format(selectedGroup.pollCount)}</strong><span>enquetes armazenadas</span></div><div><strong>{formatTimestamp(lastSync)}</strong><span>última sincronização</span></div><div><strong>{formatTimestamp(oldest, true)}</strong><span>histórico local desde</span></div></div>}
        <p className={`history-page-feedback${syncError ? ' error' : ''}`} role="status" aria-live="polite">{syncFeedback}</p>
        <div className="history-page-sync-actions"><button className="button secondary" type="button" disabled={!groupId || Boolean(syncDirection)} onClick={() => void runSync('newer')}><span className="button-label">{syncDirection === 'newer' ? 'Sincronizando...' : 'Sincronizar novidades'}</span>{syncDirection === 'newer' && <span className="spinner dark" />}</button><button className="button secondary" type="button" disabled={!groupId || Boolean(syncDirection)} onClick={() => void runSync('older')}><span className="button-label">{syncDirection === 'older' ? 'Buscando...' : 'Buscar histórico mais antigo'}</span>{syncDirection === 'older' && <span className="spinner dark" />}</button>{syncDirection && <button className="button history-cancel-button" type="button" disabled={cancelPending} onClick={() => void cancelSync()}>Cancelar</button>}</div>
      </section>

      {groupId && <section ref={browser} className="card history-browser" aria-labelledby="history-list-title"><div className="history-browser-heading"><div><p className="step">Enquetes persistidas</p><h2 id="history-list-title">{selectedGroup?.name || 'Histórico do grupo'}</h2></div><label className="history-page-size"><span>Por página</span><select value={pageSize} onChange={(event) => resetPage(() => setPageSize(Number(event.target.value)))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
        <div className="history-filters"><label className="history-search-field"><span>Buscar pela pergunta</span><input type="search" placeholder="Ex.: jogo" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label><span>De</span><input type="date" value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} /></label><label><span>Até</span><input type="date" value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} /></label>{hasFilters && <button className="button ghost history-clear-filters" type="button" onClick={clearFilters}>Limpar filtros</button>}</div>
        {listState === 'loading' && <div className="history-list-status" role="status" aria-live="polite">Carregando histórico...</div>}
        {listState === 'error' && <div className="history-list-status error" role="status" aria-live="polite">Não foi possível carregar o histórico local.<button className="button secondary" type="button" onClick={() => void loadHistory()}>Tentar novamente</button></div>}
        {listState === 'ready' && !items.length && <div className="history-list-status" role="status" aria-live="polite">{emptyText}</div>}
        {listState === 'ready' && items.length > 0 && <div className="history-page-list">{items.map((poll) => <HistoryPollCard key={poll.messageId} poll={poll} onDetail={openDetail} />)}</div>}
        {listState === 'ready' && pagination && pagination.totalPages > 0 && <nav className="history-pagination" aria-label="Paginação do histórico"><button className="button secondary" type="button" disabled={pagination.page <= 1} onClick={() => { setPage((value) => value - 1); browser.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>← Anterior</button><span>Página {pagination.page} de {pagination.totalPages}</span><button className="button secondary" type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => { setPage((value) => value + 1); browser.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Próxima →</button></nav>}
      </section>}

      <dialog ref={detailDialog} className="app-dialog history-detail-dialog" aria-labelledby="history-detail-title" onClose={() => detailController.current?.abort()} onClick={(event) => { if (event.target === detailDialog.current) closeDetail(); }}><div className="history-detail-shell"><div className="dialog-header"><div><p className="step">Detalhes da enquete</p><h2 id="history-detail-title">{detailState === 'loading' ? 'Carregando...' : detailState === 'error' ? 'Detalhes indisponíveis' : detail?.question}</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={closeDetail}>×</button></div><div className="history-detail-content" aria-live="polite">{detailState === 'loading' && <p className="history-detail-loading">Carregando detalhes...</p>}{detailState === 'error' && <p className="history-detail-notice">Não foi possível carregar os detalhes desta enquete.</p>}{detailState === 'ready' && detail && <HistoryDetailView detail={detail} />}</div></div></dialog>
      <Toast toast={toast} />
      <footer>O histórico consulta somente dados de enquetes armazenados localmente.</footer>
    </main>
  );
}

function syncSummary(result: IncrementalSyncResult): string {
  return `${plural(result.newMessages, 'nova mensagem processada', 'novas mensagens processadas')}; ${plural(result.pollsFound, 'enquete encontrada', 'enquetes encontradas')}.`;
}
function HistoryPollCard({ poll, onDetail }: { poll: PollHistoryItem; onDetail: (id: string) => Promise<void> }) {
  return <article className="history-page-poll"><div><h3>{poll.question}</h3><div className="history-page-poll-meta"><span>{formatTimestamp(poll.createdAt)}</span><span>{poll.creator ? `Criada por ${poll.creator.displayName}` : 'Autor não disponível'}</span><span>{poll.allowMultipleAnswers ? 'Múltiplas respostas' : 'Resposta única'}</span></div><div className="history-page-poll-counts"><span>{plural(poll.optionCount, 'opção', 'opções')}</span>{poll.votesSnapshotAvailable ? <><span>{plural(poll.participantCount || 0, 'participante', 'participantes')}</span><span>{plural(poll.selectionCount || 0, 'seleção', 'seleções')}</span></> : <span className="unavailable">Dados de votação ainda não disponíveis</span>}</div></div><button className="button secondary history-detail-button" type="button" onClick={() => void onDetail(poll.messageId)}>Ver detalhes</button></article>;
}
function HistoryDetailView({ detail }: { detail: PollHistoryDetail }) {
  return <><p className="history-detail-meta"><span>{formatTimestamp(detail.createdAt)}</span><span>{detail.creator ? `Criada por ${detail.creator.displayName}` : 'Autor não disponível'}</span><span>{detail.allowMultipleAnswers ? 'Múltiplas respostas permitidas' : 'Uma resposta por participante'}</span></p><section className="history-detail-section"><h3>Opções</h3><ol className="history-detail-options">{detail.options.map((option) => <li key={option.id} className="history-detail-option"><span>{option.text}</span><strong>{option.selectionCount === null ? 'contagem indisponível' : plural(option.selectionCount, 'seleção', 'seleções')}</strong></li>)}</ol></section><section className="history-detail-section"><h3>Participantes</h3>{detail.participants === null ? <p className="history-detail-notice">Os dados de votação desta enquete ainda não foram recuperados com sucesso. Sincronize ou analise o histórico novamente para tentar obter os votos.</p> : detail.participants.length === 0 ? <p className="history-detail-empty">Nenhum participante votou nesta enquete.</p> : <ul className="history-participants">{detail.participants.map((participant) => <li key={participant.id} className="history-participant"><strong>{participant.displayName}</strong><p className="history-participant-options">{participant.selectedOptions.map(({ text }) => text).join(', ')}</p>{participant.votedAt && <small className="history-participant-time">Votou em {formatTimestamp(participant.votedAt)}</small>}</li>)}</ul>}</section></>;
}
