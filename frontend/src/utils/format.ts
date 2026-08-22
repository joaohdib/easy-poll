export const numberFormatter = new Intl.NumberFormat('pt-BR');
export const percentFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const HISTORY_TIMEZONE = 'America/Sao_Paulo';
const byteFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

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

export function formatBytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes < 1024) return `${numberFormatter.format(Math.round(safeBytes))} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(safeBytes) / Math.log(1024)) - 1, units.length - 1);
  const value = safeBytes / (1024 ** (unitIndex + 1));
  return `${byteFormatter.format(value)} ${units[unitIndex]}`;
}
