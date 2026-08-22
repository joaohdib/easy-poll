import type { PollHistoryItem } from '../../types/api';
import { SearchX } from 'lucide-react';
import { PollCard } from './PollCard';
import { Skeleton } from '../ui/skeleton';

interface PollHistoryListProps {
  emptyText: string;
  items: PollHistoryItem[];
  state: 'idle' | 'loading' | 'ready' | 'error';
  onDetail: (id: string) => void;
  onRetry: () => void;
}

export function PollHistoryList({ emptyText, items, state, onDetail, onRetry }: PollHistoryListProps) {
  if (state === 'loading') return <div className="history-list-status history-loading" role="status" aria-live="polite"><Skeleton /><Skeleton /><Skeleton /><span className="sr-only">Carregando histórico...</span></div>;
  if (state === 'error') return <div className="history-list-status error" role="status" aria-live="polite">Não foi possível carregar o histórico local.<button className="button secondary" type="button" onClick={onRetry}>Tentar novamente</button></div>;
  if (state === 'ready' && !items.length) return <div className="history-list-status history-empty-state" role="status" aria-live="polite"><SearchX aria-hidden="true" /><strong>Nenhuma enquete por aqui</strong><span>{emptyText}</span></div>;
  if (state !== 'ready') return null;
  return <div className="history-page-list">{items.map((poll) => <PollCard key={poll.messageId} poll={poll} onDetail={onDetail} />)}</div>;
}
