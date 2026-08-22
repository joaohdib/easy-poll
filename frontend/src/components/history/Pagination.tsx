import type { PollHistoryPagination } from '../../types/api';

interface PaginationProps {
  pagination: PollHistoryPagination | null;
  onPageChange: (page: number) => void;
}

export function Pagination({ pagination, onPageChange }: PaginationProps) {
  if (!pagination || pagination.totalPages <= 0) return null;
  return (
    <nav className="history-pagination" aria-label="Paginação do histórico">
      <button className="button secondary" type="button" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>← Anterior</button>
      <span>Página {pagination.page} de {pagination.totalPages}</span>
      <button className="button secondary" type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>Próxima →</button>
    </nav>
  );
}
