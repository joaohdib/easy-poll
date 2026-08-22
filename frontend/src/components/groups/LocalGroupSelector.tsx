import type { LocalGroup } from '../../types/api';
import { plural } from '../../utils/format';

interface LocalGroupSelectorProps {
  groups: LocalGroup[];
  groupId: string;
  loading: boolean;
  error?: boolean;
  disabled?: boolean;
  variant: 'history' | 'stats';
  onChange: (groupId: string) => void;
}

export function LocalGroupSelector({
  groups, groupId, loading, error = false, disabled = false, variant, onChange
}: LocalGroupSelectorProps) {
  const history = variant === 'history';
  const selectId = history ? 'history-group-select' : 'stats-group-select';
  const placeholder = loading
    ? 'Carregando grupos locais...'
    : error
      ? 'Não foi possível carregar os grupos'
      : groups.length
        ? 'Selecione um grupo'
        : 'Nenhum grupo armazenado';
  const picker = (
    <>
      <div><p className="step">Dados locais</p><h2 id={history ? 'history-group-title' : 'local-stats-title'}>Grupo armazenado</h2></div>
      <label className="sr-only" htmlFor={selectId}>Selecionar grupo armazenado</label>
      <select
        id={selectId}
        aria-describedby={history ? undefined : 'stats-local-data'}
        value={groupId}
        disabled={disabled || loading || (!history && !groups.length)}
        onChange={(event) => onChange(event.target.value)}
      >
        {history && <option value="">{placeholder}</option>}
        {!history && loading && <option value="">{placeholder}</option>}
        {!history && !loading && !groups.length && <option value="">{placeholder}</option>}
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}{history ? ' — ' : ' ('}{plural(group.pollCount || 0, 'enquete', 'enquetes')}{history ? '' : ')'}
          </option>
        ))}
      </select>
    </>
  );
  return history
    ? <div className="history-group-picker">{picker}</div>
    : <div className="local-stats-picker">{picker}</div>;
}
