export const numberFormatter = new Intl.NumberFormat('pt-BR');
export const percentFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const HISTORY_TIMEZONE = 'America/Sao_Paulo';

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
export function plural(value: number, singular: string, pluralForm: string): string {
  return `${numberFormatter.format(value)} ${value === 1 ? singular : pluralForm}`;
}
export function formatPercent(value: number | null | undefined): string {
  return `${percentFormatter.format(value || 0)}%`;
}
export function errorMessage(error: unknown, fallback = 'Não foi possível concluir a solicitação.'): string {
  return error instanceof Error ? error.message : fallback;
}
export function formatTimestamp(timestamp: number | null | undefined, dateOnly = false): string {
  if (!timestamp) return 'não disponível';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return 'não disponível';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: HISTORY_TIMEZONE, dateStyle: 'short', ...(dateOnly ? {} : { timeStyle: 'short' })
  }).format(date);
}
