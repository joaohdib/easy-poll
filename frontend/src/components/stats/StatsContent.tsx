import type { StatsResult } from '../../types/api';
import { formatPercent, numberFormatter, plural } from '../../utils/format';
import { ActivityCard } from './ActivityCard';
import { PairRanking } from './PairRanking';
import { PollStatCard } from './PollStatCard';
import { RankingList } from './RankingList';
import { StatsCard } from './StatsCard';
import { StatsSection } from './StatsSection';

export function StatsContent({ stats }: { stats: StatsResult }) {
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

    <StatsSection step="Participação" title="Quem aparece em todas" note="Baseado apenas nos participantes identificados nas enquetes.">
      <div className="stat-card-grid two-columns">
        <StatsCard icon="🏆" title="Mais participativo" name={stats.mostActive?.name} accent="winner" value={stats.mostActive ? formatPercent(stats.mostActive.participationRate) : ''} description={stats.mostActive ? `${stats.mostActive.pollsParticipated} de ${eligible} enquetes com dados de votos` : 'Nenhum participante foi identificado.'} />
        <StatsCard icon="😴" title="Menos participativo" name={stats.leastActive?.name} value={stats.leastActive ? formatPercent(stats.leastActive.participationRate) : ''} description={stats.leastActive ? `${stats.leastActive.pollsParticipated} de ${eligible} enquetes com dados de votos` : 'Nenhum participante foi identificado.'} />
      </div>
    </StatsSection>

    <section className="card ranking-card" aria-labelledby="ranking-title"><div className="stats-section-heading compact"><div><p className="step">Ranking</p><h2 id="ranking-title">Participação</h2></div><small>{eligible} enquetes com dados de votos</small></div><RankingList stats={stats} /></section>

    <StatsSection step="Comportamento" title="De que lado cada um fica" note="Considera quem participou de pelo menos 20% das enquetes, além da amostra mínima de cada métrica.">
      <div id="behavior-cards" className="stat-card-grid">
        <StatsCard icon="🤝" title="Mais alinhado" name={stats.mostAligned?.name} accent="aligned" value={stats.mostAligned ? formatPercent(stats.mostAligned.alignedRate) : ''} description={stats.mostAligned ? `Acompanhou uma opção vencedora em ${stats.mostAligned.alignedPolls} de ${stats.mostAligned.behaviorPolls} enquetes.` : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`} />
        <StatsCard icon="🧨" title="Mais “do contra”" name={stats.mostContrarian?.name} accent="contrarian" value={stats.mostContrarian ? formatPercent(stats.mostContrarian.contrarianRate) : ''} description={stats.mostContrarian ? `Não escolheu nenhuma vencedora em ${stats.mostContrarian.contrarianPolls} de ${stats.mostContrarian.behaviorPolls} enquetes.` : `${participationRule} e ter ${stats.minimumBehaviorSample} resultados elegíveis.`} />
        <StatsCard icon="🎲" title="Mais imprevisível" name={stats.mostUnpredictable?.name} accent="unpredictable" value={stats.mostUnpredictable ? `${formatPercent(stats.mostUnpredictable.alignedRate)} × ${formatPercent(stats.mostUnpredictable.contrarianRate)}` : ''} description={stats.mostUnpredictable ? `Alinhado × do contra. Base: ${plural(stats.mostUnpredictable.behaviorPolls, 'enquete', 'enquetes')}.` : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`} explanation="Alterna mais entre acompanhar e contrariar o resultado das enquetes." />
        <StatsCard icon="💀" title="Azarado oficial" name={stats.unluckiestMember?.name} accent="unlucky" value={stats.unluckiestMember ? formatPercent(stats.unluckiestMember.lastPlaceRate) : ''} description={stats.unluckiestMember ? `Escolheu uma última colocada em ${stats.unluckiestMember.lastPlacePolls} de ${stats.unluckiestMember.lastPlaceEligiblePolls} enquetes.` : `${participationRule} e ter ${stats.minimumExtendedSample} resultados elegíveis.`} explanation="Mais frequentemente escolhe pelo menos uma opção que termina em último." />
      </div>
    </StatsSection>

    <StatsSection step="Velocidade" title="O ritmo das respostas" note={stats.summary.validTimestampVotes ? `Baseado em ${plural(stats.summary.validTimestampVotes, 'voto com horário disponível', 'votos com horário disponível')}.` : 'Nenhum voto possui horário válido disponível.'}>
      <div id="speed-cards" className="stat-card-grid">
        <StatsCard icon="⚡" title="Mais rápido para votar" name={stats.fastestVoter?.name} accent="speed" value={stats.fastestVoter ? `Média: ${formatDuration(stats.fastestVoter.averageVoteDelaySeconds)}` : ''} description={stats.fastestVoter ? `Baseado em ${stats.fastestVoter.validTimingSamples} enquetes com criação e voto válidos.` : `São necessárias ${stats.minimumBehaviorSample} enquetes com timestamps válidos.`} />
        <StatsCard icon="🚀" title="Primeiro a votar" name={timingNames(stats.firstVoter)} accent="first" value={stats.firstVoter ? plural(stats.firstVoter.count, 'vez', 'vezes') : ''} description={stats.firstVoter ? `${stats.firstVoter.count} de ${stats.firstVoter.eligiblePolls} enquetes elegíveis. Empates exatos creditam todos.` : 'Nenhuma enquete possui timestamp de voto válido disponível.'} />
        <StatsCard icon="🐢" title="Último a chegar" name={timingNames(stats.lastVoter)} accent="last" value={stats.lastVoter ? plural(stats.lastVoter.count, 'vez', 'vezes') : ''} description={stats.lastVoter ? `${stats.lastVoter.count} de ${stats.lastVoter.eligiblePolls} enquetes elegíveis. É o último voto entre os recuperados.` : 'Nenhuma enquete possui timestamp de voto válido disponível.'} />
      </div>
    </StatsSection>

    <StatsSection step="Afinidade de votos" title="Afinidades do grupo" note="Somente participantes com mais de 20% de participação são considerados. Cada dupla precisa ter pelo menos 5 enquetes em comum.">
      <div className="stat-card-grid one-column"><StatsCard icon="⚔️" title="Dupla mais oposta" name={stats.mostOppositePair?.members.map((member) => member.name).join(' × ')} value={stats.mostOppositePair ? formatPercent(stats.mostOppositePair.oppositionRate) : ''} description={stats.mostOppositePair ? `${plural(stats.mostOppositePair.pollsTogether, 'enquete em comum', 'enquetes em comum')}; a oposição é o inverso da sincronia média.` : `Não há pares em que ambos participaram de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes e possuem ${stats.minimumPairSample} enquetes em comum.`} explanation={`Resultado do primeiro lugar no ranking de oposição. Compara todas as opções escolhidas por Jaccard; ambos precisam participar de mais de ${formatPercent(stats.minimumBehaviorParticipationRate)} das enquetes.`} accent="opposite" /></div>
      <div className="affinity-rankings" aria-label="Rankings de afinidade de votos"><PairRanking icon="🤝" title="Mais sincronizados" ranking={stats.similarityRanking} scoreKey="similarityRate" scoreLabel="de sincronia" accent="similarity" /><PairRanking icon="⚔️" title="Mais opostos" ranking={stats.oppositionRanking} scoreKey="oppositionRate" scoreLabel="de oposição" accent="opposition" /></div>
    </StatsSection>

    <StatsSection step="Enquetes" title="Destaques das votações">
      <div className="stat-card-grid two-columns">
        <PollStatCard icon="🔥" title="Maior participação" poll={stats.highestParticipationPoll} type="highest" />
        <PollStatCard icon="⚔️" title="Enquete mais disputada" poll={stats.closestPoll} type="closest" />
        <StatsCard icon="📝" title="Mestre das enquetes" name={stats.topPollCreator?.name} accent="creator" value={stats.topPollCreator ? plural(stats.topPollCreator.pollsCreated, 'enquete', 'enquetes') : ''} description={stats.topPollCreator ? `${formatPercent(stats.topPollCreator.percentage)} das enquetes com autor identificado.` : 'Não foi possível identificar autores neste histórico.'} />
        <StatsCard icon="💤" title="Criador mais raro" name={stats.leastPollCreator?.name} value={stats.leastPollCreator ? plural(stats.leastPollCreator.pollsCreated, 'enquete', 'enquetes') : ''} description={stats.leastPollCreator ? 'Quem criou menos enquetes entre os criadores identificados.' : stats.onlyOneIdentifiedCreator ? 'Só foi identificado um criador de enquetes neste histórico.' : 'Não foi possível identificar autores suficientes.'} emptyTitle={stats.onlyOneIdentifiedCreator ? 'Um único criador' : 'Dados insuficientes'} />
      </div>
    </StatsSection>

    <StatsSection step="Atividade" title="Quando o grupo mais vota" note="Horários convertidos para America/Sao_Paulo; os timestamps originais não são alterados.">
      <div className="stat-card-grid two-columns"><ActivityCard icon="📅" title="Dia mais ativo" name={stats.mostActiveDay ? capitalize(stats.mostActiveDay.name) : undefined} value={stats.mostActiveDay ? plural(stats.mostActiveDay.count, 'participação', 'participações') : ''} description={stats.mostActiveDay ? `${formatPercent(stats.mostActiveDay.percentage)} de toda a atividade com horário disponível.` : 'Nenhum voto possui timestamp válido disponível.'} items={stats.mostActiveDay?.distribution} /><ActivityCard icon="🕐" title="Horário nobre" name={stats.primeTime?.rangeLabel} value={stats.primeTime ? plural(stats.primeTime.count, 'participação', 'participações') : ''} description={stats.primeTime ? 'Faixa de uma hora com mais participações recuperadas.' : 'Nenhum voto possui timestamp válido disponível.'} items={stats.primeTime?.topHours} /></div>
    </StatsSection>
  </div>;
}

function formatDuration(totalSeconds: number | null): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min ${remainder}s`;
  return `${remainder}s`;
}

function timingNames(result: StatsResult['firstVoter']): string {
  return result?.leaders?.map((leader) => leader.name).join(' · ') || '';
}

function capitalize(value: string): string {
  return value[0].toLocaleUpperCase('pt-BR') + value.slice(1);
}
