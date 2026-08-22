import type { DayActivity, HourActivity } from '../../types/api';
import { numberFormatter } from '../../utils/format';
import type { ReactNode } from 'react';

type DistributionItem = DayActivity | HourActivity;

interface ActivityCardProps {
  description: string;
  icon: ReactNode;
  items?: DistributionItem[];
  name?: string;
  title: string;
  value: string;
}

export function ActivityCard({ icon, title, name, value, description, items }: ActivityCardProps) {
  const max = Math.max(1, ...(items || []).map((item) => item.count));
  return <article className="card stat-card activity"><div className="person-stat-heading"><span className="person-stat-icon">{icon}</span><h3>{title}</h3></div>{name ? <><strong className="person-stat-name">{name}</strong><span className="person-stat-value">{value}</span><p className="person-stat-description">{description}</p>{items?.length ? <div className="distribution">{items.map((item) => { const label = 'shortLabel' in item ? item.shortLabel : item.label; return <div className="distribution-row" key={label}><span className="distribution-label">{label}</span><span className="distribution-track"><span className="distribution-fill" style={{ width: `${(item.count / max) * 100}%` }} /></span><strong className="distribution-value">{numberFormatter.format(item.count)}</strong></div>; })}</div> : null}</> : <><strong className="insufficient">Dados insuficientes</strong><p className="person-stat-description">{description}</p></>}</article>;
}
