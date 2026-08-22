import type { PollHistoryItem } from '../../types/api';
import { PollCard } from './PollCard';

interface PollHistoryListProps {
  emptyText: string;
  items: PollHistoryItem[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  onDetail: (id: string) => void;
  onRetry: () => void;
}

export function PollHistoryList({ emptyText, items, state, onDetail, onRetry }: PollHistoryListProps) {
  if (state === 'loading') return <div className="history-list-status" role="status" aria-live="polite">Carregando histórico...</div>;
  if (state === 'error') return <div className="history-list-status error" role="status" aria-live="polite">Não foi possível carregar o histórico local.<button className="button secondary" type="button" onClick={onRetry}>Tentar novamente</button></div>;
  if (state === 'ready' && !items.length) return <div className="history-list-status" role="status" aria-live="polite">{emptyText}</div>;
  if (state !== 'ready') return null;
  return <div className="history-page-list">{items.map((poll) => <PollCard key={poll.messageId} poll={poll} onDetail={onDetail} />)}</div>;
}
