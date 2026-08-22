import type { RefObject } from 'react';
import type { PollHistoryDetail } from '../../types/api';
import { formatTimestamp, plural } from '../../utils/format';

interface PollDetailsModalProps {
  detail: PollHistoryDetail | null;
  dialogRef: RefObject<HTMLDialogElement | null>;
  state: 'loading' | 'ready' | 'error';
  onClose: () => void;
}

export function PollDetailsModal({ detail, dialogRef, state, onClose }: PollDetailsModalProps) {
  return (
    <dialog ref={dialogRef} className="app-dialog history-detail-dialog" aria-labelledby="history-detail-title" onClose={onClose} onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}>
      <div className="history-detail-shell">
        <div className="dialog-header"><div><p className="step">Detalhes da enquete</p><h2 id="history-detail-title">{state === 'loading' ? 'Carregando...' : state === 'error' ? 'Detalhes indisponíveis' : detail?.question}</h2></div><button className="dialog-close" type="button" aria-label="Fechar" onClick={onClose}>×</button></div>
        <div className="history-detail-content" aria-live="polite">
          {state === 'loading' && <p className="history-detail-loading">Carregando detalhes...</p>}
          {state === 'error' && <p className="history-detail-notice">Não foi possível carregar os detalhes desta enquete.</p>}
          {state === 'ready' && detail && <HistoryDetail detail={detail} />}
        </div>
      </div>
    </dialog>
  );
}

function HistoryDetail({ detail }: { detail: PollHistoryDetail }) {
  const maxSelections = Math.max(1, ...detail.options.map((option) => option.selectionCount || 0));
  return <><p className="history-detail-meta"><span>{formatTimestamp(detail.createdAt)}</span><span>{detail.creator ? `Criada por ${detail.creator.displayName}` : 'Autor não disponível'}</span><span>{detail.allowMultipleAnswers ? 'Múltiplas respostas permitidas' : 'Uma resposta por participante'}</span></p><section className="history-detail-section"><h3>Opções</h3><ol className="history-detail-options">{detail.options.map((option, index) => <li key={option.id} className="history-detail-option"><span className="history-option-index">{index + 1}</span><span className="history-option-name">{option.text}</span><strong>{option.selectionCount === null ? 'contagem indisponível' : plural(option.selectionCount, 'seleção', 'seleções')}</strong>{option.selectionCount !== null && <span className="history-option-track" aria-hidden="true"><span style={{ width: `${(option.selectionCount / maxSelections) * 100}%` }} /></span>}</li>)}</ol></section><section className="history-detail-section"><h3>Participantes</h3>{detail.participants === null ? <p className="history-detail-notice">Os dados de votação desta enquete ainda não foram recuperados com sucesso. Sincronize ou analise o histórico novamente para tentar obter os votos.</p> : detail.participants.length === 0 ? <p className="history-detail-empty">Nenhum participante votou nesta enquete.</p> : <ul className="history-participants">{detail.participants.map((participant) => <li key={participant.id} className="history-participant"><strong>{participant.displayName}</strong><p className="history-participant-options">{participant.selectedOptions.map(({ text }) => text).join(', ')}</p>{participant.votedAt && <small className="history-participant-time">Votou em {formatTimestamp(participant.votedAt)}</small>}</li>)}</ul>}</section></>;
}
