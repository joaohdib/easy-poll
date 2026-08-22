import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/easypollApi';
import { LocalGroupSelector } from '../components/groups/LocalGroupSelector';
import { HistoryFilters } from '../components/history/HistoryFilters';
import { Pagination } from '../components/history/Pagination';
import { PollDetailsModal } from '../components/history/PollDetailsModal';
import { PollHistoryList } from '../components/history/PollHistoryList';
import { AppShell } from '../components/layout/AppShell';
import { HistorySyncControls } from '../components/sync/HistorySyncControls';
import { Toast } from '../components/Toast';
import { useHistory } from '../hooks/useHistory';
import { useLocalGroups } from '../hooks/useLocalGroups';
import { usePageMetadata } from '../hooks/usePageMetadata';
import { usePollDetails } from '../hooks/usePollDetails';
import { useToast } from '../hooks/useToast';
import type { IncrementalSyncResult, SyncDirection } from '../types/api';
import { errorMessage, formatTimestamp, numberFormatter, plural } from '../utils/format';
import { STORAGE_KEYS, writeStoredValue } from '../utils/storage';

export function HistoryPage() {
  usePageMetadata('Histórico — EasyPoll', 'Histórico local e persistente das enquetes do EasyPoll.');
  const { groups, groupId, setGroupId, state: groupsState, loadGroups } = useLocalGroups();
  const history = useHistory(groupId);
  const pollDetails = usePollDetails(groupId);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [oldest, setOldest] = useState<number | null>(null);
  const [syncFeedback, setSyncFeedback] = useState('Selecione um grupo para abrir o histórico local.');
  const [syncError, setSyncError] = useState(false);
  const [syncDirection, setSyncDirection] = useState<SyncDirection | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const browser = useRef<HTMLElement>(null);
  const groupValue = useRef(groupId);
  const { toast, showToast } = useToast();
  groupValue.current = groupId;

  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;

  const loadSyncStatus = useCallback(async (targetGroupId: string) => {
    try {
      const status = await api.syncStatus(targetGroupId);
      if (groupValue.current !== targetGroupId) return;
      setLastSync(status.lastSyncAt);
      setOldest(status.oldestProcessedTimestamp);
    } catch {
      if (groupValue.current !== targetGroupId) return;
      setLastSync(null);
      setOldest(null);
    }
  }, []);

  useEffect(() => {
    if (groupsState !== 'error') return;
    setSyncError(true);
    setSyncFeedback('Não foi possível carregar os grupos armazenados localmente.');
  }, [groupsState]);

  useEffect(() => {
    if (groupsState === 'error') return;
    if (!groupId) {
      if (groupsState === 'ready') window.history.replaceState(null, '', '/history');
      setSyncFeedback(groups.length
        ? 'Selecione um grupo para abrir o histórico local.'
        : 'Nenhum grupo foi armazenado ainda. Analise ou sincronize um grupo na página principal.');
      return;
    }
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
    window.history.replaceState(null, '', `/history?groupId=${encodeURIComponent(groupId)}`);
    setSyncFeedback('Histórico carregado somente do SQLite local.');
    setSyncError(false);
    void loadSyncStatus(groupId);
  }, [groupId, groups.length, groupsState, loadSyncStatus]);

  async function runSync(direction: SyncDirection) {
    if (!groupId || syncDirection) return;
    const target = groupId;
    setSyncDirection(direction);
    setSyncError(false);
    setSyncFeedback(direction === 'newer' ? 'Sincronizando mensagens mais recentes...' : 'Buscando mensagens mais antigas disponíveis...');
    try {
      const result = await api.sync(target, direction);
      if (groupValue.current !== target) return;
      if (direction === 'newer') history.setPage(1);
      const summary = syncSummary(result);
      setSyncFeedback(result.cancelled ? 'Sincronização cancelada.' : `✓ ${summary}`);
      showToast(result.cancelled ? 'Sincronização cancelada.' : summary);
      await Promise.all([loadSyncStatus(target), history.loadHistory(), refreshGroupMetadata()]);
    } catch (error) {
      if (groupValue.current !== target) return;
      const message = errorMessage(error);
      setSyncError(true);
      setSyncFeedback(message);
      showToast(message, true);
    } finally {
      if (groupValue.current === target) setSyncDirection(null);
    }
  }

  async function refreshGroupMetadata() {
    try {
      await loadGroups(true);
    } catch {
      // Existing metadata stays visible when only its refresh fails.
    }
  }

  async function cancelSync() {
    if (!groupId || !syncDirection) return;
    setCancelPending(true);
    try {
      await api.cancelSync(groupId);
      setSyncFeedback('Cancelamento solicitado...');
    } catch (error) {
      showToast(errorMessage(error), true);
    } finally {
      setCancelPending(false);
    }
  }

  const emptyText = history.hasFilters
    ? 'Nenhuma enquete encontrada para esses filtros.'
    : 'Nenhuma enquete armazenada neste grupo. Analise ou sincronize o histórico para começar.';

  return (
    <AppShell
      current="history"
      eyebrow="Sua biblioteca local de enquetes"
      title="Histórico"
      subtitle="Navegue pelas enquetes armazenadas sem reler conversas do WhatsApp."
      footer="O histórico consulta somente dados de enquetes armazenados localmente."
    >
      <section className="card history-overview" aria-labelledby="history-group-title">
        <LocalGroupSelector groups={groups} groupId={groupId} loading={groupsState === 'loading'} error={groupsState === 'error'} disabled={Boolean(syncDirection)} variant="history" onChange={setGroupId} />
        {selectedGroup && <div className="history-page-summary"><div><strong>{numberFormatter.format(selectedGroup.pollCount)}</strong><span>enquetes armazenadas</span></div><div><strong>{formatTimestamp(lastSync)}</strong><span>última sincronização</span></div><div><strong>{formatTimestamp(oldest, true)}</strong><span>histórico local desde</span></div></div>}
        <HistorySyncControls cancelPending={cancelPending} disabled={!groupId} direction={syncDirection} error={syncError} feedback={syncFeedback} onCancel={() => void cancelSync()} onSync={(direction) => void runSync(direction)} />
      </section>

      {groupId && <section ref={browser} className="card history-browser" aria-labelledby="history-list-title">
        <div className="history-browser-heading"><div><p className="step">Enquetes persistidas</p><h2 id="history-list-title">{selectedGroup?.name || 'Histórico do grupo'}</h2></div><label className="history-page-size"><span>Por página</span><select value={history.pageSize} onChange={(event) => history.resetPage(() => history.setPageSize(Number(event.target.value)))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label></div>
        <HistoryFilters search={history.search} from={history.from} to={history.to} hasFilters={history.hasFilters} onSearchChange={history.setSearch} onFromChange={(value) => history.resetPage(() => history.setFrom(value))} onToChange={(value) => history.resetPage(() => history.setTo(value))} onClear={history.clearFilters} />
        <PollHistoryList state={history.state} items={history.items} emptyText={emptyText} onDetail={(id) => void pollDetails.open(id)} onRetry={() => void history.loadHistory()} />
        {history.state === 'ready' && <Pagination pagination={history.pagination} onPageChange={(page) => { history.setPage(page); browser.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />}
      </section>}

      <PollDetailsModal dialogRef={pollDetails.dialog} detail={pollDetails.detail} state={pollDetails.state} onClose={pollDetails.close} />
      <Toast toast={toast} />
    </AppShell>
  );
}

function syncSummary(result: IncrementalSyncResult): string {
  return `${plural(result.newMessages, 'nova mensagem processada', 'novas mensagens processadas')}; ${plural(result.pollsFound, 'enquete encontrada', 'enquetes encontradas')}.`;
}
