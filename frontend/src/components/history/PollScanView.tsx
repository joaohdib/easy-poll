import type { PollScanPoll, PollScanResult } from '../../types/api';

export function PollScanView({ result, rawVisible, onToggleRaw }: { result: PollScanResult; rawVisible: boolean; onToggleRaw: () => void }) {
  return <div><div className="history-summary"><Summary value={result.messagesScanned} label="mensagens analisadas" /><Summary value={result.pollsFound} label="enquetes encontradas" /><Summary value={result.pollsWithVotesAvailable} label="com votos disponíveis" /></div><a className="button primary stats-link" href={`/stats?groupId=${encodeURIComponent(result.group.id)}`}>Ver estatísticas</a><div className="history-polls">{result.polls.length ? result.polls.map((poll, index) => <PollScanCard key={poll.messageId || index} poll={poll} />) : <p className="history-empty">Nenhuma enquete apareceu nas mensagens disponibilizadas. Isso não significa necessariamente que o grupo nunca teve enquetes.</p>}</div><button className="button secondary raw-json-button" type="button" aria-expanded={rawVisible} onClick={onToggleRaw}>{rawVisible ? 'Ocultar JSON bruto' : 'Ver JSON bruto'}</button>{rawVisible && <pre className="history-raw-json">{JSON.stringify(result, null, 2)}</pre>}</div>;
}

function Summary({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function PollScanCard({ poll }: { poll: PollScanPoll }) {
  const author = displayPerson(poll.creatorName || poll.authorName, poll.creatorId || poll.authorId);
  return <article className="history-poll"><h3>{poll.question || 'Enquete sem pergunta disponível'}</h3><div className="history-meta"><span>{formatPollDate(poll.timestamp)}</span><span>Autor: {author}</span><span>{poll.options.length} {poll.options.length === 1 ? 'opção' : 'opções'}</span><span>{poll.voteCount} {poll.voteCount === 1 ? 'voto' : 'votos'}</span></div>{poll.options.length > 0 && <ul className="history-options">{poll.options.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>}{poll.votesAvailable ? <><p className="history-votes-title">Votos</p>{poll.votes.length ? <ul className="history-votes">{poll.votes.map((vote, index) => <li key={`${vote.voterId}-${index}`} title={vote.timestamp ? formatPollDate(vote.timestamp) : undefined}>{displayPerson(vote.voterName, vote.voterId)} → {vote.selectedOptions.length ? vote.selectedOptions.join(', ') : 'nenhuma opção selecionada'}</li>)}</ul> : <p className="history-warning">Nenhum voto foi disponibilizado para esta enquete.</p>}</> : <p className="history-warning">⚠ Não foi possível recuperar os votos desta enquete{poll.votesError ? `: ${poll.votesError}` : '.'}</p>}</article>;
}

function formatPollDate(timestamp: number | null): string {
  if (!Number.isFinite(Number(timestamp))) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(Number(timestamp) * 1000));
}

function displayPerson(name?: string | null, id?: string | null): string {
  return name || id || 'Pessoa não identificada';
}
