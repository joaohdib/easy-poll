import type { StatsResult } from '../../types/api';
import { formatPercent } from '../../utils/format';

export function RankingList({ stats }: { stats: StatsResult }) {
  if (!stats.participationRanking.length) return <ol className="participation-ranking"><li className="ranking-empty">Nenhum participante identificado.</li></ol>;
  return <ol className="participation-ranking">{stats.participationRanking.map((member, index) => <li className="ranking-row" key={member.id}><span className="ranking-position">{index + 1}</span><div className="ranking-identity"><strong>{member.name}</strong><small>{member.pollsParticipated} / {stats.summary.eligiblePolls}</small></div><div className="ranking-progress"><span className="ranking-progress-bar" style={{ width: `${Math.max(0, Math.min(100, member.participationRate))}%` }} /></div><strong className="ranking-rate">{formatPercent(member.participationRate)}</strong></li>)}</ol>;
}
