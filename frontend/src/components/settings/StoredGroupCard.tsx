import { Clock3, Database, MessagesSquare, Vote } from 'lucide-react';
import type { StoredGroupSummary } from '../../types/api';
import { formatTimestamp, plural } from '../../utils/format';
import { DeleteGroupDialog } from './DeleteGroupDialog';

interface StoredGroupCardProps {
  group: StoredGroupSummary;
  onDelete: () => Promise<void>;
}

export function StoredGroupCard({ group, onDelete }: StoredGroupCardProps) {
  return <article className="settings-group-card">
    <div className="settings-group-heading"><div><h3>{group.name}</h3><small>{group.id}</small></div><DeleteGroupDialog group={group} onConfirm={onDelete} /></div>
    <div className="settings-group-counts">
      <span><Vote aria-hidden="true" />{plural(group.polls, 'enquete', 'enquetes')}</span>
      <span><Database aria-hidden="true" />{plural(group.participations, 'participação', 'participações')} · {plural(group.selections, 'seleção', 'seleções')}</span>
      <span><MessagesSquare aria-hidden="true" />{plural(group.processedMessages, 'mensagem indexada', 'mensagens indexadas')}</span>
      <span><Clock3 aria-hidden="true" />Última sync: {formatTimestamp(group.lastSyncAt)}</span>
    </div>
    <p className="settings-group-range">Intervalo indexado: {formatTimestamp(group.oldestProcessedTimestamp, true)} — {formatTimestamp(group.newestProcessedTimestamp, true)}</p>
  </article>;
}
