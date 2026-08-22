import type { Group } from '../../types/api';
import { RefreshCw, Search, Star } from 'lucide-react';

interface WhatsAppGroupSelectorProps {
  connected: boolean;
  favorites: Set<string>;
  groupId: string;
  groups: Group[];
  help: string;
  loading: boolean;
  search: string;
  visibleGroups: Group[];
  onChange: (groupId: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onToggleFavorite: (groupId: string) => void;
}

export function WhatsAppGroupSelector({ connected, favorites, groupId, groups, help, loading, search, visibleGroups, onChange, onRefresh, onSearchChange, onToggleFavorite }: WhatsAppGroupSelectorProps) {
  return <div className="field group-field"><label htmlFor="group">Grupo de destino</label><select id="group" className="sr-only" name="groupId" required tabIndex={-1} aria-hidden="true" value={groupId} onChange={(event) => onChange(event.target.value)}><option value="">{connected ? 'Selecione um grupo' : 'Conecte o WhatsApp primeiro'}</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><div className="group-picker"><div className="group-toolbar"><label className="group-search"><Search aria-hidden="true" /><span className="sr-only">Buscar grupo</span><input type="search" placeholder="Buscar grupo..." autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} /></label><button className="button secondary refresh-button" type="button" aria-label="Atualizar grupos" disabled={loading} onClick={onRefresh}><RefreshCw aria-hidden="true" className={loading ? 'is-spinning' : undefined} /><span>Atualizar</span></button></div><div className="group-list" role="listbox" aria-label="Grupos do WhatsApp">{visibleGroups.map((group) => { const selected = group.id === groupId; const favorite = favorites.has(group.id); return <div key={group.id} className={`group-row${selected ? ' selected' : ''}`} role="option" aria-selected={selected}><button className="group-choice" type="button" onClick={() => onChange(group.id)}><span className="group-indicator" aria-hidden="true" /><span className="group-name">{group.name}</span>{selected && <span className="selected-copy">Selecionado</span>}</button><button className={`favorite-button${favorite ? ' active' : ''}`} type="button" aria-label={`${favorite ? 'Desfavoritar' : 'Favoritar'} ${group.name}`} aria-pressed={favorite} onClick={() => onToggleFavorite(group.id)}><Star aria-hidden="true" fill={favorite ? 'currentColor' : 'none'} /></button></div>; })}</div>{!visibleGroups.length && <p className="group-empty">Nenhum grupo encontrado nessa busca.</p>}</div><small>{help}</small></div>;
}
