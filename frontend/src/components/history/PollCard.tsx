import type { PollHistoryItem } from '../../types/api';
import { formatTimestamp, plural } from '../../utils/format';

export function PollCard({ poll, onDetail }: { poll: PollHistoryItem; onDetail: (id: string) => void }) {
  return (
    <article className="history-page-poll">
      <div>
        <h3>{poll.question}</h3>
        <div className="history-page-poll-meta"><span>{formatTimestamp(poll.createdAt)}</span><span>{poll.creator ? `Criada por ${poll.creator.displayName}` : 'Autor não disponível'}</span><span>{poll.allowMultipleAnswers ? 'Múltiplas respostas' : 'Resposta única'}</span></div>
        <div className="history-page-poll-counts"><span>{plural(poll.optionCount, 'opção', 'opções')}</span>{poll.votesSnapshotAvailable ? <><span>{plural(poll.participantCount || 0, 'participante', 'participantes')}</span><span>{plural(poll.selectionCount || 0, 'seleção', 'seleções')}</span></> : <span className="unavailable">Dados de votação ainda não disponíveis</span>}</div>
      </div>
      <button className="button secondary history-detail-button" type="button" onClick={() => onDetail(poll.messageId)}>Ver detalhes</button>
    </article>
  );
}
