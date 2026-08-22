import { useEffect } from 'react';
import { LocalGroupSelector } from '../components/groups/LocalGroupSelector';
import { AppShell } from '../components/layout/AppShell';
import { StatsContent } from '../components/stats/StatsContent';
import { useLocalGroups } from '../hooks/useLocalGroups';
import { usePageMetadata } from '../hooks/usePageMetadata';
import { useStats } from '../hooks/useStats';
import { errorMessage, plural } from '../utils/format';
import { STORAGE_KEYS, writeStoredValue } from '../utils/storage';

interface EmptyState { title: string; detail: string }

export function StatsPage() {
  usePageMetadata('EasyPoll Stats', 'EasyPoll Stats — estatísticas das enquetes do seu grupo.');
  const { error: groupsError, groups, groupId, setGroupId, state: groupsState } = useLocalGroups({ selectFirst: true });
  const { result, loading: statsLoading, error: statsError } = useStats(groupId);

  useEffect(() => {
    if (!groupId) return;
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
    const url = new URL(window.location.href);
    url.searchParams.set('groupId', groupId);
    window.history.replaceState(null, '', url);
  }, [groupId]);

  const loading = groupsState === 'loading' || statsLoading || Boolean(groupId && !result && !statsError);
  const empty = getEmptyState(groupsState, groups.length, result?.stats.summary.pollsFound, groupsError, statsError);
  const stats = result?.stats.summary.pollsFound ? result.stats : null;
  const groupName = groupsState === 'loading'
    ? 'Carregando análise mais recente…'
    : groupsState === 'error'
      ? 'Servidor indisponível'
      : statsError
        ? 'Dados locais indisponíveis'
        : result?.stats.summary.group?.name || (groups.length ? 'Carregando análise mais recente…' : 'Nenhum dado local disponível');
  const localData = groupsState === 'error'
    ? 'Os grupos locais não puderam ser carregados.'
    : !groups.length && groupsState === 'ready'
      ? 'Nenhum grupo foi importado para o SQLite.'
      : result
        ? `Última sincronização: ${formatLocalTimestamp(result.localData?.lastSyncAt)} · ${plural(result.localData?.messagesProcessed || 0, 'mensagem processada', 'mensagens processadas')}`
        : 'Aguardando dados locais...';

  return (
    <AppShell
      current="stats"
      eyebrow="As histórias por trás dos votos"
      title="Estatísticas"
      subtitle={groupName}
      footer="Os dados existem somente nesta sessão local e incluem apenas informações relacionadas às enquetes."
    >
      <section className="card local-stats-controls" aria-labelledby="local-stats-title">
        <LocalGroupSelector groups={groups} groupId={groupId} loading={groupsState === 'loading'} error={groupsState === 'error'} variant="stats" onChange={setGroupId} />
        <div className="local-stats-meta"><p id="stats-local-data">{localData}</p><a className="button secondary" href={groupId ? `/?groupId=${encodeURIComponent(groupId)}` : '/'}>Sincronizar</a></div>
      </section>
      {loading && <section className="card stats-message" role="status">Calculando estatísticas…</section>}
      {!loading && empty && <section className="card stats-message"><span className="stats-message-icon" aria-hidden="true">📊</span><h2>{empty.title}</h2><p>{empty.detail}</p><a className="button primary" href="/">Voltar</a></section>}
      {!loading && stats && <StatsContent stats={stats} />}
    </AppShell>
  );
}

function getEmptyState(
  groupsState: 'loading' | 'ready' | 'error',
  groupCount: number,
  pollsFound: number | undefined,
  groupsError: unknown,
  statsError: unknown
): EmptyState | null {
  if (groupsState === 'error') return {
    title: 'Não foi possível carregar as estatísticas.',
    detail: errorMessage(groupsError, 'Confira se o EasyPoll está em execução e tente novamente.')
  };
  if (groupsState === 'ready' && !groupCount) return {
    title: 'Ainda não há grupos armazenados.',
    detail: 'Conecte o WhatsApp e importe ou sincronize o histórico de um grupo primeiro.'
  };
  if (statsError) return {
    title: 'Não foi possível carregar as estatísticas.',
    detail: errorMessage(statsError, 'Confira se o EasyPoll está em execução e tente novamente.')
  };
  if (pollsFound === 0) return {
    title: 'Ainda não há enquetes importadas para este grupo.',
    detail: 'Sincronize ou analise o histórico primeiro.'
  };
  return null;
}

function formatLocalTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return 'nunca';
  const date = new Date(timestamp * 1_000);
  return Number.isNaN(date.getTime()) ? 'indisponível' : date.toLocaleString('pt-BR');
}
