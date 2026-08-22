import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-bold transition-[color,background-color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[0_8px_20px_rgba(18,117,81,.16)] hover:bg-[var(--primary-hover)]',
        secondary: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-muted)]',
        ghost: 'bg-transparent text-[var(--primary-hover)] hover:bg-[var(--primary-soft)]',
        destructive: 'border border-[var(--danger-border)] bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[#fee2e2]'
      },
      size: {
        default: 'min-h-11',
        sm: 'min-h-9 px-3 text-xs',
        icon: 'size-10 p-0'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'default' }
  }
);

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ asChild = false, className, variant, size, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
