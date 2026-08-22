import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/easypollApi';
import { BrandMark } from '../components/BrandMark';
import { Navigation } from '../components/Navigation';
import { usePageMetadata } from '../hooks/usePageMetadata';
import type {
  DayActivity, HourActivity, LocalGroup, PairAffinity, PollResult, StatsResult
} from '../types/api';
import { errorMessage, formatPercent, numberFormatter, plural } from '../utils/format';
import { readStoredValue, STORAGE_KEYS, writeStoredValue } from '../utils/storage';

interface EmptyState { title: string; detail: string }

export function StatsPage() {
  usePageMetadata('EasyPoll Stats', 'EasyPoll Stats — estatísticas das enquetes do seu grupo.');
  const [groups, setGroups] = useState<LocalGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [groupName, setGroupName] = useState('Carregando análise mais recente…');
  const [localData, setLocalData] = useState('Aguardando dados locais...');
  const [empty, setEmpty] = useState<EmptyState | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    void api.localGroups().then(({ groups: localGroups }) => {
      setGroups(localGroups); setGroupsLoading(false);
      if (!localGroups.length) {
        setLoading(false); setGroupName('Nenhum dado local disponível');
        setLocalData('Nenhum grupo foi importado para o SQLite.');
        setEmpty({ title: 'Ainda não há grupos armazenados.', detail: 'Conecte o WhatsApp e importe ou sincronize o histórico de um grupo primeiro.' });
        return;
      }
      const requested = new URLSearchParams(window.location.search).get('groupId') || '';
      const stored = readStoredValue(STORAGE_KEYS.lastGroupId);
      const preferred = [requested, stored].find((candidate) => localGroups.some((group) => group.id === candidate)) || localGroups[0].id;
      setGroupId(preferred);
    }).catch((error) => {
      setGroupsLoading(false); setLoading(false); setGroupName('Servidor indisponível');
      setLocalData('Os grupos locais não puderam ser carregados.');
      setEmpty({ title: 'Não foi possível carregar as estatísticas.', detail: errorMessage(error, 'Confira se o EasyPoll está em execução e tente novamente.') });
    });
    return () => requestController.current?.abort();
  }, []);

  useEffect(() => {
    if (!groupId) return;
    writeStoredValue(STORAGE_KEYS.lastGroupId, groupId);
    const url = new URL(window.location.href); url.searchParams.set('groupId', groupId);
    window.history.replaceState(null, '', url);
    requestController.current?.abort();
    const controller = new AbortController(); requestController.current = controller;
    setLoading(true); setStats(null); setEmpty(null);
    void api.stats(groupId, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      setLocalData(`Última sincronização: ${formatLocalTimestamp(data.localData?.lastSyncAt)} · ${plural(data.localData?.messagesProcessed || 0, 'mensagem processada', 'mensagens processadas')}`);
      const name = data.stats.summary.group?.name || 'Grupo sem nome'; setGroupName(name);
      if (!data.stats.summary.pollsFound) {
        setEmpty({ title: 'Ainda não há enquetes importadas para este grupo.', detail: 'Sincronize ou analise o histórico primeiro.' });
      } else setStats(data.stats);
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLoading(false); setGroupName('Dados locais indisponíveis');
      setEmpty({ title: 'Não foi possível carregar as estatísticas.', detail: errorMessage(error, 'Confira se o EasyPoll está em execução e tente novamente.') });
    });
    return () => controller.abort();
  }, [groupId]);

  return (
    <main className="stats-shell">
      <a className="stats-back" href="/">← Voltar para EasyPoll</a>
      <header className="stats-hero"><BrandMark variant="stats" /><div><p className="eyebrow">Análise de participação</p><h1>EasyPoll Stats</h1><p>{groupName}</p></div></header>
      <Navigation current="stats" />
      <section className="card local-stats-controls" aria-labelledby="local-stats-title"><div className="local-stats-picker"><div><p className="step">Dados locais</p><h2 id="local-stats-title">Grupo armazenado</h2></div><label htmlFor="stats-group-select" className="sr-only">Selecionar grupo armazenado</label><select id="stats-group-select" aria-describedby="stats-local-data" value={groupId} disabled={groupsLoading || !groups.length} onChange={(event) => setGroupId(event.target.value)}>{groupsLoading ? <option value="">Carregando grupos locais...</option> : groups.length ? groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({plural(group.pollCount || 0, 'enquete', 'enquetes')})</option>) : <option value="">Nenhum grupo armazenado</option>}</select></div><div className="local-stats-meta"><p id="stats-local-data">{localData}</p><a className="button secondary" href={groupId ? `/?groupId=${encodeURIComponent(groupId)}` : '/'}>Sincronizar</a></div></section>
      {loading && <section className="card stats-message" role="status">Calculando estatísticas…</section>}
      {!loading && empty && <section className="card stats-message"><span className="stats-message-icon" aria-hidden="true">📊</span><h2>{empty.title}</h2><p>{empty.detail}</p><a className="button primary" href="/">Voltar</a></section>}
      {!loading && stats && <StatsContent stats={stats} />}
      <footer>Os dados existem somente nesta sessão local e incluem apenas informações relacionadas às enquetes.</footer>
    </main>
  );
}

function formatLocalTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return 'nunca';
  const date = new Date(timestamp * 1_000);
  return Number.isNaN(date.getTime()) ? 'indisponível' : date.toLocaleString('pt-BR');
}
function formatDuration(totalSeconds: number | null): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${remainder}s`;
  return `${remainder}s`;
}
function timingNames(result: StatsResult['firstVoter']): string { return result?.leaders?.map((leader) => leader.name).join(' · ') || ''; }

function StatsContent({ stats }: { stats: StatsResult }) {
  const eligible = stats.summary.eligiblePolls;
  const participationRule = `É preciso participar de pelo menos ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes`;
  const summaryItems: Array<[number, string]> = [
    [stats.summary.pollsFound, 'enquetes encontradas'],
    [stats.summary.eligiblePolls, 'com dados de votação'],
    [stats.summary.totalParticipations, 'participações'],
    [stats.summary.identifiedParticipants, 'participantes identificados'],
    [stats.summary.validTimestampVotes, 'votos com horário válido'],
    [stats.summary.identifiedCreators, `criadores · ${stats.summary.pollsWithIdentifiedCreator}/${stats.summary.pollsFound} enquetes com autor`]
  ];
  return <div>
    <section className="stats-summary" aria-label="Resumo da análise">{summaryItems.map(([value, label]) => <div className="summary-stat" key={label}><strong>{numberFormatter.format(value)}</strong><span>{label}</span></div>)}</section>
    <StatsSection step="Participação" title="Quem aparece em todas" note="Baseado apenas nos participantes identificados nas enquetes."><div className="stat-card-grid two-columns"><StatCard icon="🏆" title="Mais participativo" name={stats.mostActive?.name} accent="winner" value={stats.mostActive ? formatPercent(stats.mostActive.participationRate) : ''} description={stats.mostActive ? `${stats.mostActive.pollsParticipated} de ${eligible} enquetes com dados de votos` : 'Nenhum participante foi identificado.'} /><StatCard icon="😴" title="Menos participativo" name={stats.leastActive?.name} value={stats.leastActive ? formatPercent(stats.leastActive.participationRate) : ''} description={stats.leastActive ? `${stats.leastActive.pollsParticipated} de ${eligible} enquetes com dados de votos` : 'Nenhum participante foi identificado.'} /></div></StatsSection>
    <section className="card ranking-card" aria-labelledby="ranking-title"><div className="stats-section-heading compact"><div><p className="step">Ranking</p><h2 id="ranking-title">Participação</h2></div><small>{eligible} enquetes com dados de votos</small></div><ParticipationRanking stats={stats} /></section>
    <StatsSection step="Comportamento" title="De que lado cada um fica" note="Considera quem participou de pelo menos 20% das enquetes, além da amostra mínima de cada métrica."><div id="behavior-cards" className="stat-card-grid"><StatCard icon="🤝" title="Mais alinhado" name={stats.mostAligned?.name} accent="aligned" value={stats.mostAligned ? formatPercent(stats.mostAligned.alignedRate) : ''} description={stats.mostAligned ? `Acompanhou uma opção vencedora em ${stats.mostAligned.alignedPolls} de ${stats.mostAligned.behaviorPolls} enquetes.` : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`} /><StatCard icon="🧨" title="Mais “do contra”" name={stats.mostContrarian?.name} accent="contrarian" value={stats.mostContrarian ? formatPercent(stats.mostContrarian.contrarianRate) : ''} description={stats.mostContrarian ? `Não escolheu nenhuma vencedora em ${stats.mostContrarian.contrarianPolls} de ${stats.mostContrarian.behaviorPolls} enquetes.` : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`} /><StatCard icon="🎲" title="Mais imprevisível" name={stats.mostUnpredictable?.name} accent="unpredictable" value={stats.mostUnpredictable ? `${formatPercent(stats.mostUnpredictable.alignedRate)} × ${formatPercent(stats.mostUnpredictable.contrarianRate)}` : ''} description={stats.mostUnpredictable ? `Alinhado × do contra. Base: ${plural(stats.mostUnpredictable.behaviorPolls, 'enquete', 'enquetes')}.` : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`} explanation="Alterna mais entre acompanhar e contrariar o resultado das enquetes." /><StatCard icon="💀" title="Azarado oficial" name={stats.unluckiestMember?.name} accent="unlucky" value={stats.unluckiestMember ? formatPercent(stats.unluckiestMember.lastPlaceRate) : ''} description={stats.unluckiestMember ? `Escolheu uma última colocada em ${stats.unluckiestMember.lastPlacePolls} de ${stats.unluckiestMember.lastPlaceEligiblePolls} enquetes.` : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`} explanation="Mais frequentemente escolhe pelo menos uma opção que termina em último." /></div></StatsSection>
    <StatsSection step="Velocidade" title="O ritmo das respostas" note={stats.summary.validTimestampVotes ? `Baseado em ${plural(stats.summary.validTimestampVotes, 'voto com horário disponível', 'votos com horário disponível')}.` : 'Nenhum voto possui horário válido disponível.'}><div id="speed-cards" className="stat-card-grid"><StatCard icon="⚡" title="Mais rápido para votar" name={stats.fastestVoter?.name} accent="speed" value={stats.fastestVoter ? `Média: ${formatDuration(stats.fastestVoter.averageVoteDelaySeconds)}` : ''} description={stats.fastestVoter ? `Baseado em ${stats.fastestVoter.validTimingSamples} enquetes com criação e voto válidos.` : `São necessárias ${stats.minimumBehaviorSample} enquetes com timestamps válidos.`} /><StatCard icon="🚀" title="Primeiro a votar" name={timingNames(stats.firstVoter)} accent="first" value={stats.firstVoter ? plural(stats.firstVoter.count, 'vez', 'vezes') : ''} description={stats.firstVoter ? `${stats.firstVoter.count} de ${stats.firstVoter.eligiblePolls} enquetes elegíveis. Empates exatos creditam todos.` : 'Nenhuma enquete possui timestamp de voto válido disponível.'} /><StatCard icon="🐢" title="Último a chegar" name={timingNames(stats.lastVoter)} accent="last" value={stats.lastVoter ? plural(stats.lastVoter.count, 'vez', 'vezes') : ''} description={stats.lastVoter ? `${stats.lastVoter.count} de ${stats.lastVoter.eligiblePolls} enquetes elegíveis. É o último voto entre os recuperados.` : 'Nenhuma enquete possui timestamp de voto válido disponível.'} /></div></StatsSection>
    <StatsSection step="Afinidade de votos" title="Afinidades do grupo" note="Somente participantes com mais de 20% de participação são considerados. Cada dupla precisa ter pelo menos 5 enquetes em comum."><div className="stat-card-grid one-column"><StatCard icon="⚔️" title="Dupla mais oposta" name={stats.mostOppositePair?.members.map((member) => member.name).join(' × ')} value={stats.mostOppositePair ? formatPercent(stats.mostOppositePair.oppositionRate) : ''} description={stats.mostOppositePair ? `${plural(stats.mostOppositePair.pollsTogether, 'enquete em comum', 'enquetes em comum')}; a oposição é o inverso da sincronia média.` : `Não há pares em que ambos participaram de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes e possuem ${stats.minimumPairSample} enquetes em comum.`} explanation={`Resultado do primeiro lugar no ranking de oposição. Compara todas as opções escolhidas por Jaccard; ambos precisam participar de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes.`} accent="opposite" /></div><div className="affinity-rankings" aria-label="Rankings de afinidade de votos"><AffinityRanking icon="🤝" title="Mais sincronizados" ranking={stats.similarityRanking} scoreKey="similarityRate" scoreLabel="de sincronia" accent="similarity" /><AffinityRanking icon="⚔️" title="Mais opostos" ranking={stats.oppositionRanking} scoreKey="oppositionRate" scoreLabel="de oposição" accent="opposition" /></div></StatsSection>
    <StatsSection step="Enquetes" title="Destaques das votações"><div className="stat-card-grid two-columns"><PollCard icon="🔥" title="Maior participação" poll={stats.highestParticipationPoll} type="highest" /><PollCard icon="⚔️" title="Enquete mais disputada" poll={stats.closestPoll} type="closest" /><StatCard icon="📝" title="Mestre das enquetes" name={stats.topPollCreator?.name} accent="creator" value={stats.topPollCreator ? plural(stats.topPollCreator.pollsCreated, 'enquete', 'enquetes') : ''} description={stats.topPollCreator ? `${formatPercent(stats.topPollCreator.percentage)} das enquetes com autor identificado.` : 'Não foi possível identificar autores neste histórico.'} /><StatCard icon="💤" title="Criador mais raro" name={stats.leastPollCreator?.name} value={stats.leastPollCreator ? plural(stats.leastPollCreator.pollsCreated, 'enquete', 'enquetes') : ''} description={stats.leastPollCreator ? 'Quem criou menos enquetes entre os criadores identificados.' : stats.onlyOneIdentifiedCreator ? 'Só foi identificado um criador de enquetes neste histórico.' : 'Não foi possível identificar autores suficientes.'} emptyTitle={stats.onlyOneIdentifiedCreator ? 'Um único criador' : 'Dados insuficientes'} /></div></StatsSection>
    <StatsSection step="Atividade" title="Quando o grupo mais vota" note="Horários convertidos para America/Sao_Paulo; os timestamps originais não são alterados."><div className="stat-card-grid two-columns"><ActivityCard icon="📅" title="Dia mais ativo" name={stats.mostActiveDay ? capitalize(stats.mostActiveDay.name) : undefined} value={stats.mostActiveDay ? plural(stats.mostActiveDay.count, 'participação', 'participações') : ''} description={stats.mostActiveDay ? `${formatPercent(stats.mostActiveDay.percentage)} de toda a atividade com horário disponível.` : 'Nenhum voto possui timestamp válido disponível.'} items={stats.mostActiveDay?.distribution} /><ActivityCard icon="🕐" title="Horário nobre" name={stats.primeTime?.rangeLabel} value={stats.primeTime ? plural(stats.primeTime.count, 'participação', 'participações') : ''} description={stats.primeTime ? 'Faixa de uma hora com mais participações recuperadas.' : 'Nenhum voto possui timestamp válido disponível.'} items={stats.primeTime?.topHours} /></div></StatsSection>
  </div>;
}

function StatsSection({ step, title, note, children }: { step: string; title: string; note?: string; children: ReactNode }) {
  const id = `${step.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}-title`;
  return <section aria-labelledby={id}><div className="stats-section-heading"><div><p className="step">{step}</p><h2 id={id}>{title}</h2></div>{note && <small>{note}</small>}</div>{children}</section>;
}
interface StatCardProps { icon: string; title: string; name?: string | null; value: string; description: string; explanation?: string; accent?: string; emptyTitle?: string }
function StatCard({ icon, title, name, value, description, explanation, accent, emptyTitle }: StatCardProps) {
  return <article className={`card stat-card ${accent || ''}`}><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3>{explanation && <span className="stat-info" title={explanation} tabIndex={0} role="img" aria-label={explanation}>?</span>}</div>{name ? <><strong className="person-stat-name">{name}</strong><span className="person-stat-value">{value}</span><p className="person-stat-description">{description}</p></> : <><strong className="insufficient">{emptyTitle || 'Dados insuficientes'}</strong><p className="person-stat-description">{description}</p></>}</article>;
}
function ParticipationRanking({ stats }: { stats: StatsResult }) {
  if (!stats.participationRanking.length) return <ol className="participation-ranking"><li className="ranking-empty">Nenhum participante identificado.</li></ol>;
  return <ol className="participation-ranking">{stats.participationRanking.map((member, index) => <li className="ranking-row" key={member.id}><span className="ranking-position">{index + 1}</span><div className="ranking-identity"><strong>{member.name}</strong><small>{member.pollsParticipated} / {stats.summary.eligiblePolls}</small></div><div className="ranking-progress"><span className="ranking-progress-bar" style={{ width: `${Math.max(0, Math.min(100, member.participationRate))}%` }} /></div><strong className="ranking-rate">{formatPercent(member.participationRate)}</strong></li>)}</ol>;
}
function AffinityRanking({ icon, title, ranking, scoreKey, scoreLabel, accent }: { icon: string; title: string; ranking: PairAffinity[]; scoreKey: 'similarityRate' | 'oppositionRate'; scoreLabel: string; accent: string }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`card affinity-ranking ${accent}${expanded ? ' expanded' : ''}`}><div className="affinity-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{!ranking.length ? <><strong className="affinity-empty-title">Ainda não há duplas elegíveis para este ranking.</strong><p className="affinity-empty-copy">Cada participante precisa ter votado em mais de 20% das enquetes analisadas e a dupla precisa ter pelo menos 5 enquetes em comum.</p></> : <><ol className="affinity-list">{ranking.map((pair, index) => <li key={`${pair.memberA.id}-${pair.memberB.id}`} className={`affinity-row${index >= 5 ? ' affinity-extra' : ''}`}><span className="affinity-position">#{index + 1}</span><div className="affinity-identity"><strong>{pair.members.map((member) => member.name).join(' + ')}</strong><small>{plural(pair.pollsTogether, 'enquete em comum', 'enquetes em comum')}</small></div><div className="affinity-score"><strong>{formatPercent(pair[scoreKey])}</strong><small>{scoreLabel}</small></div><span className="affinity-track"><span className="affinity-fill" style={{ width: `${Math.max(0, Math.min(100, pair[scoreKey]))}%` }} /></span></li>)}</ol>{ranking.length > 5 && <button className="affinity-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar somente Top 5' : 'Ver ranking completo'}</button>}</>}</article>;
}
function PollCard({ icon, title, poll, type }: { icon: string; title: string; poll: (PollResult & { leaders?: Array<{ name: string; voteCount: number }>; difference?: number }) | null; type: 'highest' | 'closest' }) {
  return <article className="card stat-card poll-stat-card"><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{!poll ? <><strong className="insufficient">Dados insuficientes</strong><p className="person-stat-description">{type === 'closest' ? 'É preciso haver ao menos 3 participantes e 2 opções votadas.' : 'Nenhuma enquete com dados de votos foi encontrada.'}</p></> : <><strong className="poll-stat-question">“{poll.question}”</strong>{type === 'highest' ? <><span className="poll-stat-main-value">{plural(poll.participantCount, 'participante', 'participantes')}</span><p className="person-stat-description">{plural(poll.optionCount, 'opção', 'opções')}</p></> : <><div className="closest-results">{poll.leaders?.map((option) => <div className="closest-result-row" key={option.name}><span>{option.name}</span><strong>{option.voteCount}</strong></div>)}</div><p className="poll-difference">Diferença: {plural(poll.difference || 0, 'voto', 'votos')}</p></>}</>}</article>;
}
type DistributionItem = DayActivity | HourActivity;
function ActivityCard({ icon, title, name, value, description, items }: { icon: string; title: string; name?: string; value: string; description: string; items?: DistributionItem[] }) {
  const max = Math.max(1, ...(items || []).map((item) => item.count));
  return <article className="card stat-card activity"><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{name ? <><strong className="person-stat-name">{name}</strong><span className="person-stat-value">{value}</span><p className="person-stat-description">{description}</p>{items?.length ? <div className="distribution">{items.map((item) => { const label = 'shortLabel' in item ? item.shortLabel : item.label; return <div className="distribution-row" key={label}><span className="distribution-label">{label}</span><span className="distribution-track"><span className="distribution-fill" style={{ width: `${(item.count / max) * 100}%` }} /></span><strong className="distribution-value">{numberFormatter.format(item.count)}</strong></div>; })}</div> : null}</> : <><strong className="insufficient">Dados insuficientes</strong><p className="person-stat-description">{description}</p></>}</article>;
}
function capitalize(value: string): string { return value[0].toLocaleUpperCase('pt-BR') + value.slice(1); }
