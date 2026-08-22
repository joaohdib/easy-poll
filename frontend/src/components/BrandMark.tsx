interface BrandMarkProps { variant?: 'poll' | 'history' | 'stats'; compact?: boolean }

export function BrandMark({ variant = 'poll', compact = false }: BrandMarkProps) {
  return (
    <div className={`brand-mark${compact ? ' compact' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3v-3H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
        {variant === 'poll' && <path d="m7 10 1.6 1.6L12 8.2M14 9h4M14 13h4" />}
        {variant === 'history' && <path d="M8 9h8M8 12h8M8 15h5" />}
        {variant === 'stats' && <path d="M7 14v-2m4 2V8m4 6v-4m4 4V7" />}
      </svg>
    </div>
  );
}
