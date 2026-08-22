import type { ReactNode } from 'react';

export interface StatsCardProps {
  accent?: string;
  description: string;
  emptyTitle?: string;
  explanation?: string;
  icon: ReactNode;
  name?: string | null;
  title: string;
  value: string;
}

export function StatsCard({ icon, title, name, value, description, explanation, accent, emptyTitle }: StatsCardProps) {
  return <article className={`card stat-card ${accent || ''}`}><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3>{explanation && <span className="stat-info" title={explanation} tabIndex={0} role="img" aria-label={explanation}>?</span>}</div>{name ? <><strong className="person-stat-name">{name}</strong><span className="person-stat-value">{value}</span><p className="person-stat-description">{description}</p></> : <><strong className="insufficient">{emptyTitle || 'Dados insuficientes'}</strong><p className="person-stat-description">{description}</p></>}</article>;
}
