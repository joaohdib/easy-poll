interface HistoryFiltersProps {
  from: string;
  hasFilters: boolean;
  search: string;
  to: string;
  onClear: () => void;
  onFromChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function HistoryFilters({
  from, hasFilters, search, to, onClear, onFromChange, onSearchChange, onToChange
}: HistoryFiltersProps) {
  return (
    <div className="history-filters">
      <label className="history-search-field"><span>Buscar pela pergunta</span><input type="search" placeholder="Ex.: jogo" autoComplete="off" value={search} onChange={(event) => onSearchChange(event.target.value)} /></label>
      <label><span>De</span><input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} /></label>
      <label><span>Até</span><input type="date" value={to} onChange={(event) => onToChange(event.target.value)} /></label>
      {hasFilters && <button className="button ghost history-clear-filters" type="button" onClick={onClear}>Limpar filtros</button>}
    </div>
  );
}
