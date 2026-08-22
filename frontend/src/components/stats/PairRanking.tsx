import { useState } from 'react';
import type { PairAffinity } from '../../types/api';
import { formatPercent, plural } from '../../utils/format';

interface PairRankingProps {
  accent: string;
  icon: string;
  ranking: PairAffinity[];
  scoreKey: 'similarityRate' | 'oppositionRate';
  scoreLabel: string;
  title: string;
}

export function PairRanking({ icon, title, ranking, scoreKey, scoreLabel, accent }: PairRankingProps) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`card affinity-ranking ${accent}${expanded ? ' expanded' : ''}`}><div className="affinity-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{!ranking.length ? <><strong className="affinity-empty-title">Ainda não há duplas elegíveis para este ranking.</strong><p className="affinity-empty-copy">Cada participante precisa ter votado em mais de 20% das enquetes analisadas e a dupla precisa ter pelo menos 5 enquetes em comum.</p></> : <><ol className="affinity-list">{ranking.map((pair, index) => <li key={`${pair.memberA.id}-${pair.memberB.id}`} className={`affinity-row${index >= 5 ? ' affinity-extra' : ''}`}><span className="affinity-position">#{index + 1}</span><div className="affinity-identity"><strong>{pair.members.map((member) => member.name).join(' + ')}</strong><small>{plural(pair.pollsTogether, 'enquete em comum', 'enquetes em comum')}</small></div><div className="affinity-score"><strong>{formatPercent(pair[scoreKey])}</strong><small>{scoreLabel}</small></div><span className="affinity-track"><span className="affinity-fill" style={{ width: `${Math.max(0, Math.min(100, pair[scoreKey]))}%` }} /></span></li>)}</ol>{ranking.length > 5 && <button className="affinity-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Mostrar somente Top 5' : 'Ver ranking completo'}</button>}</>}</article>;
}
