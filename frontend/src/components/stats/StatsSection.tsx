import type { ReactNode } from 'react';

export function StatsSection({ step, title, note, children }: { step: string; title: string; note?: string; children: ReactNode }) {
  const id = `${step.toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}-title`;
  return <section aria-labelledby={id}><div className="stats-section-heading"><div><p className="step">{step}</p><h2 id={id}>{title}</h2></div>{note && <small>{note}</small>}</div>{children}</section>;
}
