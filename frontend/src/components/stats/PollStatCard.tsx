import type { PollResult } from '../../types/api';
import { plural } from '../../utils/format';
import type { ReactNode } from 'react';

interface PollStatCardProps {
  icon: ReactNode;
  poll: (PollResult & { leaders?: Array<{ name: string; voteCount: number }>; difference?: number }) | null;
  title: string;
  type: 'highest' | 'closest';
}

export function PollStatCard({ icon, title, poll, type }: PollStatCardProps) {
  return <article className="card stat-card poll-stat-card"><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{!poll ? <><strong className="insufficient">Dados insuficientes</strong><p className="person-stat-description">{type === 'closest' ? 'É preciso haver ao menos 3 participantes e 2 opções votadas.' : 'Nenhuma enquete com dados de votos foi encontrada.'}</p></> : <><strong className="poll-stat-question">“{poll.question}”</strong>{type === 'highest' ? <><span className="poll-stat-main-value">{plural(poll.participantCount, 'participante', 'participantes')}</span><p className="person-stat-description">{plural(poll.optionCount, 'opção', 'opções')}</p></> : <><div className="closest-results">{poll.leaders?.map((option) => <div className="closest-result-row" key={option.name}><span>{option.name}</span><strong>{option.voteCount}</strong></div>)}</div><p className="poll-difference">Diferença: {plural(poll.difference || 0, 'voto', 'votos')}</p></>}</>}</article>;
}
